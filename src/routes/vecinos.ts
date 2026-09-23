// Perfil propio (/yo), vecinos y manzanas. Alta, edición e invitaciones: solo el comité.
import { Router } from 'express';
import { and, asc, eq, ne, sql } from 'drizzle-orm';
import { enviarEnlaceClave, requireComite } from '../auth.ts';
import { db } from '../db/index.ts';
import { manzanas, ROLES, sesiones, vecinos } from '../db/schema.ts';
import { conflicto, errnoMysql, invalido, noEncontrado } from '../errors.ts';
import { hashPassword, verifyPassword } from '../password.ts';
import * as validar from '../validar.ts';

export const rutasVecinos = Router();

const columnasVecino = {
    id: vecinos.id,
    nombre: vecinos.nombre,
    apellido: vecinos.apellido,
    email: vecinos.email,
    telefono: vecinos.telefono,
    manzana_id: vecinos.manzanaId,
    manzana: manzanas.nombre,
    rol: vecinos.rol,
    activo: vecinos.activo,
    invitacion_pendiente: sql<boolean>`${vecinos.passwordHash} IS NULL`.mapWith(Boolean),
    ultimo_acceso: vecinos.ultimoAcceso,
};

async function buscarVecinos(where?: ReturnType<typeof eq>) {
    const filas = await db
        .select(columnasVecino)
        .from(vecinos)
        .innerJoin(manzanas, eq(manzanas.id, vecinos.manzanaId))
        .where(where)
        .orderBy(asc(vecinos.apellido), asc(vecinos.nombre));
    return filas.map((v) => ({ ...v, ultimo_acceso: validar.iso(v.ultimo_acceso) }));
}

async function vecinoPorId(id: number) {
    const [v] = await buscarVecinos(eq(vecinos.id, id));
    if (!v) throw noEncontrado('El vecino no existe.');
    return v;
}

/** Traduce los errores de restricciones de la base a 409/400 en vez de 500. */
function erroresDeAlta(e: unknown): never {
    if (errnoMysql(e) === 1062) throw conflicto('Ya hay un vecino con ese email o teléfono.');
    if (errnoMysql(e) === 1452) throw invalido('La manzana no existe.');
    throw e;
}

// --- Perfil propio ---

rutasVecinos.get('/yo', async (req, res) => {
    const { activo: _a, invitacion_pendiente: _i, ultimo_acceso: _u, ...perfil } = await vecinoPorId(req.vecino.id);
    res.json(perfil);
});

rutasVecinos.post('/yo/clave', async (req, res) => {
    const actual = typeof req.body?.actual === 'string' ? req.body.actual.slice(0, 128) : '';
    const nueva = validar.password(req.body?.nueva, 'nueva');
    const [v] = await db.select({ passwordHash: vecinos.passwordHash }).from(vecinos).where(eq(vecinos.id, req.vecino.id));
    // 400 y no 401: un 401 hace que la app cierre la sesión.
    if (!(await verifyPassword(actual, v?.passwordHash))) throw invalido('La contraseña actual no es correcta.');

    await db.update(vecinos).set({ passwordHash: await hashPassword(nueva) }).where(eq(vecinos.id, req.vecino.id));
    // Cierra las otras sesiones; la del pedido sigue viva.
    await db.delete(sesiones).where(and(eq(sesiones.vecinoId, req.vecino.id), ne(sesiones.tokenHash, req.vecino.tokenHash)));
    res.status(204).end();
});

// --- Manzanas ---

rutasVecinos.get('/manzanas', async (_req, res) => {
    res.json(await db.select().from(manzanas).orderBy(asc(manzanas.nombre)));
});

rutasVecinos.post('/manzanas', requireComite, async (req, res) => {
    const nombre = validar.texto(req.body?.nombre, 'nombre', 50);
    const [r] = await db.insert(manzanas).values({ nombre }).$returningId();
    res.status(201).json({ id: r!.id, nombre });
});

// --- Vecinos (comité) ---

rutasVecinos.get('/vecinos', requireComite, async (_req, res) => {
    res.json(await buscarVecinos());
});

rutasVecinos.post('/vecinos', requireComite, async (req, res) => {
    const b = req.body ?? {};
    const nuevo = {
        nombre: validar.texto(b.nombre, 'nombre', 40),
        apellido: validar.texto(b.apellido, 'apellido', 40),
        email: validar.email(b.email),
        telefono: validar.telefono(b.telefono),
        manzanaId: validar.id(b.manzana_id, 'manzana_id'),
        rol: b.rol === undefined ? ('vecino' as const) : validar.unoDe(b.rol, ROLES, 'rol'),
    };
    const [r] = await db.insert(vecinos).values(nuevo).$returningId().catch(erroresDeAlta);

    // El vecino ya quedó creado: si el correo falla, se avisa y el comité puede reenviar la invitación.
    let invitacionEnviada = true;
    try {
        await enviarEnlaceClave({ id: r!.id, nombre: nuevo.nombre, email: nuevo.email }, 'invitacion');
    } catch (e) {
        invitacionEnviada = false;
        console.error('[vecinos] no se pudo enviar la invitación:', (e as Error)?.message);
    }
    res.status(201).json({ ...(await vecinoPorId(r!.id)), invitacion_enviada: invitacionEnviada });
});

rutasVecinos.patch('/vecinos/:id', requireComite, async (req, res) => {
    const id = validar.id(req.params.id);
    const b = req.body ?? {};
    const cambios: Partial<typeof vecinos.$inferInsert> = {};
    if (b.nombre !== undefined) cambios.nombre = validar.texto(b.nombre, 'nombre', 40);
    if (b.apellido !== undefined) cambios.apellido = validar.texto(b.apellido, 'apellido', 40);
    if (b.telefono !== undefined) cambios.telefono = validar.telefono(b.telefono);
    if (b.manzana_id !== undefined) cambios.manzanaId = validar.id(b.manzana_id, 'manzana_id');
    if (b.rol !== undefined) cambios.rol = validar.unoDe(b.rol, ROLES, 'rol');
    if (b.activo !== undefined) cambios.activo = validar.booleano(b.activo, 'activo');
    if (Object.keys(cambios).length === 0) throw invalido('No hay cambios para aplicar.');
    // Evita que el comité se quede sin administradores por accidente.
    if (id === req.vecino.id && (cambios.rol !== undefined || cambios.activo !== undefined)) {
        throw conflicto('No podés cambiar tu propio rol ni desactivarte.');
    }

    await vecinoPorId(id);
    await db.update(vecinos).set(cambios).where(eq(vecinos.id, id)).catch(erroresDeAlta);
    if (cambios.activo === false) await db.delete(sesiones).where(eq(sesiones.vecinoId, id));
    res.json(await vecinoPorId(id));
});

rutasVecinos.post('/vecinos/:id/invitacion', requireComite, async (req, res) => {
    const v = await vecinoPorId(validar.id(req.params.id));
    if (!v.activo) throw conflicto('El vecino está desactivado.');
    if (!v.invitacion_pendiente) throw conflicto('El vecino ya activó su cuenta; puede usar "olvidé mi contraseña".');
    await enviarEnlaceClave(v, 'invitacion');
    res.status(204).end();
});
