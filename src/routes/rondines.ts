// Grilla semanal de rondines (RF-07), asistencia (RF-08) y gestión de turnos del comité.
import { Router } from 'express';
import { and, asc, between, eq, notInArray, sql, type SQL } from 'drizzle-orm';
import { requireComite } from '../auth.ts';
import { config } from '../config.ts';
import { db } from '../db/index.ts';
import { turnoAsignaciones, turnosRondin, vecinos } from '../db/schema.ts';
import { conflicto, errnoMysql, invalido, noEncontrado } from '../errors.ts';
import { correo, enviarSinEsperar } from '../mail.ts';
import * as validar from '../validar.ts';

export const rutasRondines = Router();

/** Lunes de la semana actual en la zona del barrio (en UTC, el domingo 21 h ya sería lunes). */
export function lunesDeEstaSemana(ahora = new Date(), tz = config.barrioTz): string {
    const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(ahora); // AAAA-MM-DD
    const d = new Date(`${hoy}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    return d.toISOString().slice(0, 10);
}

const sumarDias = (fecha: string, dias: number) => {
    const d = new Date(`${fecha}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + dias);
    return d.toISOString().slice(0, 10);
};

type EstadoAsignacion = (typeof turnoAsignaciones.$inferSelect)['estado'];

/** Consulta de la spec §4.3: `pareja` llega como 'María R.|Tomás R.' y `mi_estado` es null si el turno es de otros. */
async function buscarTurnos(where: SQL | undefined, vecinoId: number) {
    const filas = await db
        .select({
            id: turnosRondin.id,
            fecha: turnosRondin.fecha,
            hora_inicio: sql<string>`TIME_FORMAT(${turnosRondin.horaInicio}, '%H:%i')`,
            hora_fin: sql<string>`TIME_FORMAT(${turnosRondin.horaFin}, '%H:%i')`,
            ruta: turnosRondin.ruta,
            pareja: sql<string | null>`GROUP_CONCAT(CONCAT(${vecinos.nombre}, ' ', LEFT(${vecinos.apellido}, 1), '.') ORDER BY ${vecinos.id} SEPARATOR '|')`,
            mi_estado: sql<EstadoAsignacion | null>`MAX(CASE WHEN ${turnoAsignaciones.vecinoId} = ${vecinoId} THEN ${turnoAsignaciones.estado} END)`,
        })
        .from(turnosRondin)
        .leftJoin(turnoAsignaciones, eq(turnoAsignaciones.turnoId, turnosRondin.id))
        .leftJoin(vecinos, eq(vecinos.id, turnoAsignaciones.vecinoId))
        .where(where)
        // Todas las columnas no agregadas: MariaDB con ONLY_FULL_GROUP_BY no infiere la dependencia de la PK.
        .groupBy(turnosRondin.id, turnosRondin.fecha, turnosRondin.horaInicio, turnosRondin.horaFin, turnosRondin.ruta)
        .orderBy(asc(turnosRondin.fecha));
    return filas.map((t) => ({ ...t, pareja: t.pareja ? t.pareja.split('|') : [] }));
}

async function turnoPorId(id: number, vecinoId: number) {
    const [t] = await buscarTurnos(eq(turnosRondin.id, id), vecinoId);
    if (!t) throw noEncontrado('El turno no existe.');
    return t;
}

rutasRondines.get('/rondines/semana', async (req, res) => {
    const desde = req.query.desde === undefined ? lunesDeEstaSemana() : validar.fecha(req.query.desde, 'desde');
    res.json(await buscarTurnos(between(turnosRondin.fecha, desde, sumarDias(desde, 6)), req.vecino.id));
});

rutasRondines.post('/rondines/:id/asistencia', async (req, res) => {
    const turnoId = validar.id(req.params.id);
    const presente = validar.booleano(req.body?.presente, 'presente');
    const donde = and(eq(turnoAsignaciones.turnoId, turnoId), eq(turnoAsignaciones.vecinoId, req.vecino.id));

    const [asignacion] = await db.select({ estado: turnoAsignaciones.estado }).from(turnoAsignaciones).where(donde);
    if (!asignacion) throw noEncontrado('No estás asignado a ese turno.');

    const estado = presente ? 'confirmado' : 'ausente';
    await db.update(turnoAsignaciones).set({ estado, respondidoEn: sql`UTC_TIMESTAMP()` }).where(donde);
    const turno = await turnoPorId(turnoId, req.vecino.id);

    // "El comité recibe el aviso para reasignar el turno" (spec §3.5). Solo al pasar a ausente.
    if (estado === 'ausente' && asignacion.estado !== 'ausente') await avisarAusencia(req.vecino.id, turno);
    res.json(turno);
});

async function avisarAusencia(vecinoId: number, turno: { fecha: string; hora_inicio: string; hora_fin: string; ruta: string }) {
    const [v] = await db.select({ nombre: vecinos.nombre, apellido: vecinos.apellido }).from(vecinos).where(eq(vecinos.id, vecinoId));
    const comite = await db
        .select({ email: vecinos.email })
        .from(vecinos)
        .where(and(eq(vecinos.rol, 'comite'), eq(vecinos.activo, true)));
    for (const { email } of comite) {
        enviarSinEsperar(
            correo(email, `Rondín del ${turno.fecha}: ${v!.nombre} ${v!.apellido} no se presenta`, {
                titulo: 'Turno de rondín sin cubrir',
                parrafos: [
                    `${v!.nombre} ${v!.apellido} avisó que no se presenta al rondín del ${turno.fecha} (${turno.hora_inicio}–${turno.hora_fin}, ${turno.ruta}).`,
                    'Hay que reasignar el turno desde el panel del comité.',
                ],
            }),
        );
    }
}

// --- Gestión del comité ---

/** Traduce FKs y duplicados a 400/409. */
function erroresDeTurno(e: unknown): never {
    if (errnoMysql(e) === 1062) throw conflicto('Ya hay un turno en esa fecha.');
    if (errnoMysql(e) === 1452) throw invalido('Alguno de los vecinos no existe.');
    throw e;
}

async function asignaciones(turnoId: number) {
    const filas = await db
        .select({
            vecino_id: turnoAsignaciones.vecinoId,
            nombre: sql<string>`CONCAT(${vecinos.nombre}, ' ', ${vecinos.apellido})`,
            estado: turnoAsignaciones.estado,
            respondido_en: turnoAsignaciones.respondidoEn,
        })
        .from(turnoAsignaciones)
        .innerJoin(vecinos, eq(vecinos.id, turnoAsignaciones.vecinoId))
        .where(eq(turnoAsignaciones.turnoId, turnoId))
        .orderBy(asc(vecinos.id));
    return filas.map((a) => ({ ...a, respondido_en: validar.iso(a.respondido_en) }));
}

rutasRondines.post('/rondines', requireComite, async (req, res) => {
    const b = req.body ?? {};
    const turno = {
        fecha: validar.fecha(b.fecha, 'fecha'),
        ruta: validar.texto(b.ruta, 'ruta', 200),
        horaInicio: b.hora_inicio === undefined ? '22:00:00' : validar.hora(b.hora_inicio, 'hora_inicio'),
        horaFin: b.hora_fin === undefined ? '02:00:00' : validar.hora(b.hora_fin, 'hora_fin'),
    };
    const vecinoIds = b.vecino_ids === undefined ? [] : validar.ids(b.vecino_ids, 'vecino_ids');

    const id = await db
        .transaction(async (tx) => {
            const [r] = await tx.insert(turnosRondin).values(turno).$returningId();
            if (vecinoIds.length) {
                await tx.insert(turnoAsignaciones).values(vecinoIds.map((vecinoId) => ({ turnoId: r!.id, vecinoId })));
            }
            return r!.id;
        })
        .catch(erroresDeTurno);
    res.status(201).json(await turnoPorId(id, req.vecino.id));
});

rutasRondines.get('/rondines/:id/asignaciones', requireComite, async (req, res) => {
    const turno = await turnoPorId(validar.id(req.params.id), req.vecino.id);
    res.json(await asignaciones(turno.id));
});

/** Reemplaza la lista de asignados. Quien sigue asignado conserva su respuesta; los nuevos quedan pendientes. */
rutasRondines.put('/rondines/:id/asignaciones', requireComite, async (req, res) => {
    const turno = await turnoPorId(validar.id(req.params.id), req.vecino.id);
    const vecinoIds = validar.ids(req.body?.vecino_ids, 'vecino_ids');

    await db
        .transaction(async (tx) => {
            await tx
                .delete(turnoAsignaciones)
                .where(and(eq(turnoAsignaciones.turnoId, turno.id), vecinoIds.length ? notInArray(turnoAsignaciones.vecinoId, vecinoIds) : undefined));
            if (vecinoIds.length) {
                await tx
                    .insert(turnoAsignaciones)
                    .values(vecinoIds.map((vecinoId) => ({ turnoId: turno.id, vecinoId })))
                    .onDuplicateKeyUpdate({ set: { turnoId: sql`turno_id` } }); // ya asignado: no tocar
            }
        })
        .catch(erroresDeTurno);
    res.json(await asignaciones(turno.id));
});

rutasRondines.delete('/rondines/:id', requireComite, async (req, res) => {
    const turno = await turnoPorId(validar.id(req.params.id), req.vecino.id);
    await db.delete(turnosRondin).where(eq(turnosRondin.id, turno.id));
    res.status(204).end();
});
