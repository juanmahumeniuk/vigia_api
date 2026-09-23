// Sesión: invitación por correo + contraseña (reemplaza el SMS de RF-09, ver docs/CAMBIOS_CLIENTE.md).
import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { and, eq, gt, sql } from 'drizzle-orm';
import { config } from '../config.ts';
import { crearSesion, enviarEnlaceClave, requireAuth, sha256 } from '../auth.ts';
import { db } from '../db/index.ts';
import { sesiones, tokensClave, vecinos } from '../db/schema.ts';
import { enviarError, HttpError, invalido } from '../errors.ts';
import { hashFicticio, hashPassword, verifyPassword } from '../password.ts';
import * as validar from '../validar.ts';

export const rutasAuth = Router();

// ponytail: store en memoria, alcanza con un solo proceso Node (Hostinger). Con varias instancias, pasar a un store compartido.
rutasAuth.use(
    rateLimit({
        windowMs: 15 * 60 * 1000,
        limit: config.authRateLimitMax,
        standardHeaders: 'draft-8',
        legacyHeaders: false,
        handler: (_req, res) => enviarError(res, 429, 'Demasiados intentos. Probá de nuevo en unos minutos.'),
    }),
);

rutasAuth.post('/login', async (req, res) => {
    const email = validar.email(req.body?.email);
    const password = typeof req.body?.password === 'string' ? req.body.password.slice(0, 128) : '';

    const [v] = await db
        .select({ id: vecinos.id, passwordHash: vecinos.passwordHash })
        .from(vecinos)
        .where(and(eq(vecinos.email, email), eq(vecinos.activo, true)));
    // Se verifica siempre (contra un hash ficticio si hace falta): el tiempo no revela si el email existe.
    const ok = await verifyPassword(password, v?.passwordHash ?? (await hashFicticio()));
    if (!v || !ok) throw new HttpError(401, 'Email o contraseña incorrectos.');

    res.json(await crearSesion(v.id));
});

/** Canjea el enlace de invitación o de recuperación: fija la contraseña y abre sesión. */
rutasAuth.post('/clave', async (req, res) => {
    const token = String(req.body?.token ?? '').toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(token)) throw invalido('El enlace no es válido.');
    const passwordHash = await hashPassword(validar.password(req.body?.password));

    const vecinoId = await db.transaction(async (tx) => {
        const [fila] = await tx
            .select({ vecinoId: tokensClave.vecinoId, tipo: tokensClave.tipo })
            .from(tokensClave)
            .innerJoin(vecinos, eq(vecinos.id, tokensClave.vecinoId))
            .where(and(eq(tokensClave.tokenHash, sha256(token)), gt(tokensClave.expiraEn, sql`UTC_TIMESTAMP()`), eq(vecinos.activo, true)))
            .for('update');
        if (!fila) throw invalido('El enlace venció o ya se usó. Pedí uno nuevo.');

        await tx.update(vecinos).set({ passwordHash }).where(eq(vecinos.id, fila.vecinoId));
        await tx.delete(tokensClave).where(eq(tokensClave.vecinoId, fila.vecinoId));
        // Recuperar la clave cierra todas las sesiones: quien la pidió puede haber perdido el celular.
        if (fila.tipo === 'recuperacion') await tx.delete(sesiones).where(eq(sesiones.vecinoId, fila.vecinoId));
        return fila.vecinoId;
    });

    res.json(await crearSesion(vecinoId));
});

/** Siempre 204, exista o no el email (no se puede usar para averiguar quién está registrado). */
rutasAuth.post('/recuperar', async (req, res) => {
    const email = validar.email(req.body?.email);
    const [v] = await db
        .select({ id: vecinos.id, nombre: vecinos.nombre, email: vecinos.email })
        .from(vecinos)
        .where(and(eq(vecinos.email, email), eq(vecinos.activo, true)));
    // Sin await: el tiempo de respuesta es el mismo exista o no el email.
    if (v) enviarEnlaceClave(v, 'recuperacion').catch((e) => console.error('[recuperar] envío fallido:', e?.message));
    res.status(204).end();
});

rutasAuth.post('/logout', requireAuth, async (req, res) => {
    await db.delete(sesiones).where(eq(sesiones.tokenHash, req.vecino.tokenHash));
    res.status(204).end();
});
