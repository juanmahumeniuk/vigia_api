// Alertas SOS: disparo (RF-01), triple confirmación (RF-02), cancelación (RF-03) y el resto del
// ciclo que la spec dejaba abierto: alertas activas del barrio, "voy en camino", 911 y resolver.
import { Router } from 'express';
import { and, desc, eq, sql, type SQL } from 'drizzle-orm';
import { requireComite } from '../auth.ts';
import { db } from '../db/index.ts';
import { alertaRespuestas, alertas, manzanas, vecinos } from '../db/schema.ts';
import { conflicto, HttpError, noEncontrado } from '../errors.ts';
import * as validar from '../validar.ts';

export const rutasAlertas = Router();

const ESTADOS = ['activa', 'cancelada', 'resuelta'] as const;
type EstadoRespuesta = (typeof alertaRespuestas.$inferSelect)['estado'];

async function buscarAlertas(where: SQL, vecinoId: number, limite: number) {
    const filas = await db
        .select({
            id: alertas.id,
            estado: alertas.estado,
            central911Confirmada: alertas.central911Confirmada,
            vecinosAvisados: sql<number>`COUNT(${alertaRespuestas.vecinoId})`.mapWith(Number),
            enCamino: sql<number>`COALESCE(SUM(${alertaRespuestas.estado} = 'en_camino'), 0)`.mapWith(Number),
            miRespuesta: sql<EstadoRespuesta | null>`MAX(CASE WHEN ${alertaRespuestas.vecinoId} = ${vecinoId} THEN ${alertaRespuestas.estado} END)`,
            lat: alertas.lat,
            lng: alertas.lng,
            creadaEn: alertas.creadaEn,
            cerradaEn: alertas.cerradaEn,
            autorId: vecinos.id,
            autorNombre: vecinos.nombre,
            autorApellido: vecinos.apellido,
            manzana: manzanas.nombre,
        })
        .from(alertas)
        .innerJoin(vecinos, eq(vecinos.id, alertas.vecinoId))
        .innerJoin(manzanas, eq(manzanas.id, vecinos.manzanaId))
        .leftJoin(alertaRespuestas, eq(alertaRespuestas.alertaId, alertas.id))
        .where(where)
        .groupBy(alertas.id, vecinos.id, manzanas.id)
        .orderBy(desc(alertas.creadaEn), desc(alertas.id))
        .limit(limite);
    return filas.map((a) => ({
        // Los cinco primeros son los que ya lee EstadoAlerta.fromJson (lib/models/alerta.dart).
        id: a.id,
        estado: a.estado,
        central_911_confirmada: a.central911Confirmada,
        vecinos_avisados: a.vecinosAvisados,
        en_camino: a.enCamino,
        mi_respuesta: a.miRespuesta,
        lat: a.lat,
        lng: a.lng,
        creada_en: validar.iso(a.creadaEn),
        cerrada_en: validar.iso(a.cerradaEn),
        vecino: { id: a.autorId, nombre: `${a.autorNombre} ${a.autorApellido}`, manzana: a.manzana },
    }));
}

async function alertaPorId(id: number, vecinoId: number) {
    const [a] = await buscarAlertas(eq(alertas.id, id), vecinoId, 1);
    if (!a) throw noEncontrado('La alerta no existe.');
    return a;
}

/** Cierra una alerta activa. 0 filas = otro pedido la cerró antes (carrera) → 409. */
async function cerrar(id: number, estado: 'cancelada' | 'resuelta') {
    const [r] = await db
        .update(alertas)
        .set({ estado, cerradaEn: sql`UTC_TIMESTAMP()` })
        .where(and(eq(alertas.id, id), eq(alertas.estado, 'activa')));
    if (r.affectedRows === 0) throw conflicto('La alerta ya no está activa.');
    return { id, estado };
}

/** RF-01 / RNF-01: la alerta y la fila de cada vecino avisado se crean en una sola transacción. */
rutasAlertas.post('/alertas', async (req, res) => {
    const lat = validar.coordenada(req.body?.lat, 'lat', 90);
    const lng = validar.coordenada(req.body?.lng, 'lng', 180);
    const yo = req.vecino.id;

    const { id, nueva } = await db.transaction(async (tx) => {
        // Bloquea la fila del vecino: dos toques seguidos del SOS no crean dos alertas.
        await tx.select({ id: vecinos.id }).from(vecinos).where(eq(vecinos.id, yo)).for('update');
        const [activa] = await tx
            .select({ id: alertas.id })
            .from(alertas)
            .where(and(eq(alertas.vecinoId, yo), eq(alertas.estado, 'activa')))
            .limit(1);
        if (activa) return { id: activa.id, nueva: false };

        const [r] = await tx.insert(alertas).values({ vecinoId: yo, lat, lng }).$returningId();
        await tx.execute(
            sql`INSERT INTO ${alertaRespuestas} (alerta_id, vecino_id) SELECT ${r!.id}, id FROM ${vecinos} WHERE activo = 1 AND id <> ${yo}`,
        );
        return { id: r!.id, nueva: true };
    });
    // Si ya tenía una activa se devuelve esa (200) y no se vuelve a avisar a todo el barrio.
    res.status(nueva ? 201 : 200).json({ id, estado: 'activa' });
});

rutasAlertas.get('/alertas', async (req, res) => {
    const estado = req.query.estado === undefined ? 'activa' : validar.unoDe(req.query.estado, ESTADOS, 'estado');
    res.json(await buscarAlertas(eq(alertas.estado, estado), req.vecino.id, 50));
});

/** RF-02: la app la consulta cada 2 s mientras la pantalla de alerta está abierta. */
rutasAlertas.get('/alertas/:id', async (req, res) => {
    res.json(await alertaPorId(validar.id(req.params.id), req.vecino.id));
});

/** RF-03: solo quien la disparó, y solo si sigue activa. */
rutasAlertas.post('/alertas/:id/cancelar', async (req, res) => {
    const a = await alertaPorId(validar.id(req.params.id), req.vecino.id);
    if (a.vecino.id !== req.vecino.id) throw noEncontrado('La alerta no existe.');
    res.json(await cerrar(a.id, 'cancelada'));
});

/** La emergencia terminó. Quien la disparó o el comité. */
rutasAlertas.post('/alertas/:id/resolver', async (req, res) => {
    const a = await alertaPorId(validar.id(req.params.id), req.vecino.id);
    if (a.vecino.id !== req.vecino.id && req.vecino.rol !== 'comite') {
        throw new HttpError(403, 'Solo quien disparó la alerta o el comité pueden resolverla.');
    }
    res.json(await cerrar(a.id, 'resuelta'));
});

/** Un vecino avisado dice "voy en camino" (o se retracta con en_camino: false). */
rutasAlertas.post('/alertas/:id/en-camino', async (req, res) => {
    const enCamino = validar.booleano(req.body?.en_camino, 'en_camino');
    const a = await alertaPorId(validar.id(req.params.id), req.vecino.id);
    if (a.mi_respuesta === null) throw noEncontrado('No fuiste avisado de esta alerta.');
    if (a.estado !== 'activa') throw conflicto('La alerta ya no está activa.');

    await db
        .update(alertaRespuestas)
        .set({ estado: enCamino ? 'en_camino' : 'notificado', actualizadoEn: sql`UTC_TIMESTAMP()` })
        .where(and(eq(alertaRespuestas.alertaId, a.id), eq(alertaRespuestas.vecinoId, req.vecino.id)));
    res.json(await alertaPorId(a.id, req.vecino.id));
});

/** El comité confirma que la central 911 tomó el aviso. Idempotente. */
rutasAlertas.post('/alertas/:id/confirmar-911', requireComite, async (req, res) => {
    const a = await alertaPorId(validar.id(req.params.id), req.vecino.id);
    if (a.estado !== 'activa') throw conflicto('La alerta ya no está activa.');
    await db.update(alertas).set({ central911Confirmada: true }).where(eq(alertas.id, a.id));
    res.json(await alertaPorId(a.id, req.vecino.id));
});
