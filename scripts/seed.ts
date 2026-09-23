// Datos de desarrollo: `npm run db:seed`. BORRA todo lo que haya en la base (nunca en producción).
// Todos los vecinos entran con la contraseña "vigia1234"; laura@vigia.test es del comité.
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import { db, pool } from '../src/db/index.ts';
import { manzanas, publicaciones, turnoAsignaciones, turnosRondin, vecinos } from '../src/db/schema.ts';
import { hashPassword } from '../src/password.ts';
import { lunesDeEstaSemana } from '../src/routes/rondines.ts';

export const PASSWORD_SEED = 'vigia1234';

const TABLAS = ['alerta_respuestas', 'alertas', 'publicacion_respuestas', 'publicaciones', 'turno_asignaciones',
    'turnos_rondin', 'sesiones', 'tokens_clave', 'vecinos', 'manzanas'];

export async function sembrar() {
    if (process.env.NODE_ENV === 'production') throw new Error('El seed borra datos: no se corre en producción.');

    await db.transaction(async (tx) => {
        await tx.execute(sql`SET FOREIGN_KEY_CHECKS = 0`);
        for (const t of TABLAS) await tx.execute(sql.raw(`TRUNCATE TABLE ${t}`));
        await tx.execute(sql`SET FOREIGN_KEY_CHECKS = 1`);
    });

    await db.insert(manzanas).values([1, 2, 3, 4, 5].map((n) => ({ id: n, nombre: `Manzana ${n}` })));

    const passwordHash = await hashPassword(PASSWORD_SEED);
    const personas = [
        ['María', 'Ríos', 'maria', 4, 'vigia'],
        ['Tomás', 'Rodríguez', 'tomas', 4, 'vigia'],
        ['Jorge', 'López', 'jorge', 2, 'vecino'],
        ['Ana', 'Castro', 'ana', 2, 'vecino'],
        ['Laura', 'Gómez', 'laura', 1, 'comite'],
        ['Pedro', 'Sosa', 'pedro', 3, 'vecino'],
        ['Lucía', 'Fernández', 'lucia', 3, 'vigia'],
        ['Diego', 'Martínez', 'diego', 5, 'vecino'],
    ] as const;
    await db.insert(vecinos).values(
        personas.map(([nombre, apellido, usuario, manzanaId, rol], i) => ({
            id: i + 1,
            nombre,
            apellido,
            email: `${usuario}@vigia.test`,
            telefono: `+54911000000${String(i + 1).padStart(2, '0')}`,
            manzanaId,
            rol,
            passwordHash,
        })),
    );
    // Invitación pendiente (sin contraseña), para probar el flujo de alta.
    await db.insert(vecinos).values({ id: 9, nombre: 'Sofía', apellido: 'Paz', email: 'sofia@vigia.test', manzanaId: 5 });

    const haceMin = (m: number) => new Date(Math.floor(Date.now() / 1000 - m * 60) * 1000);
    await db.insert(publicaciones).values([
        { autorId: 3, tipo: 'actividad', titulo: 'Cierre de la calle Juárez por obra', creadoEn: haceMin(20) },
        { autorId: 4, tipo: 'actividad', titulo: 'Camioneta gris estacionada desde ayer', creadoEn: haceMin(55) },
        { autorId: 5, firma: 'Comité', tipo: 'noticia', etiqueta: 'seguridad', titulo: 'Reunión con el cuadrante policial el jueves 19 h', cuerpo: 'En el salón de la parroquia. Traigan sus propuestas.', creadoEn: haceMin(120) },
        { autorId: 5, firma: 'Municipio', tipo: 'noticia', etiqueta: 'alumbrado', titulo: 'Cambio de luminarias en la calle Morelos', creadoEn: haceMin(600) },
        { autorId: 5, firma: 'Comité', tipo: 'noticia', etiqueta: 'obras', titulo: 'Bacheo en el acceso norte la semana próxima', creadoEn: haceMin(1500) },
    ]);

    const lunes = new Date(`${lunesDeEstaSemana()}T00:00:00Z`);
    const parejas = [[3, 4], [6, 7], [1, 2], [3, 4], [7, 8], [1, 6], [2, 8]];
    for (const [i, pareja] of parejas.entries()) {
        const fecha = new Date(lunes.getTime() + i * 86_400_000).toISOString().slice(0, 10);
        const [t] = await db.insert(turnosRondin).values({ fecha, ruta: 'Morelos → Juárez → Parque → Morelos' }).$returningId();
        await db.insert(turnoAsignaciones).values(pareja.map((vecinoId) => ({ turnoId: t!.id, vecinoId })));
    }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    await sembrar();
    console.log(`[seed] listo. Entrá con maria@vigia.test (o laura@vigia.test, comité) y la contraseña "${PASSWORD_SEED}".`);
    await pool.end();
}
