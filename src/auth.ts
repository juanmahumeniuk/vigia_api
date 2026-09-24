import { createHash, randomBytes } from 'node:crypto';
import type { RequestHandler } from 'express';
import { and, eq, gt, lt, sql } from 'drizzle-orm';
import { config } from './config.ts';
import { db } from './db/index.ts';
import { manzanas, sesiones, tokensClave, vecinos } from './db/schema.ts';
import { HttpError } from './errors.ts';
import { correo, enviarCorreo } from './mail.ts';
import { iso } from './validar.ts';

export type Rol = (typeof vecinos.$inferSelect)['rol'];
export type VecinoSesion = { id: number; rol: Rol; tokenHash: string };

declare global {
    namespace Express {
        interface Request {
            /** Lo carga requireAuth; en las rutas protegidas siempre está. */
            vecino: VecinoSesion;
        }
    }
}

const SESION_MS = 24 * 60 * 60 * 1000; // RNF-03
const VIGENCIA_TOKEN_MS = { invitacion: 7 * 24 * 60 * 60 * 1000, recuperacion: 60 * 60 * 1000 };

export const sha256 = (valor: string) => createHash('sha256').update(valor).digest('hex');
const tokenAleatorio = () => randomBytes(32).toString('hex');
const sinMs = (ms: number) => new Date(Math.floor(ms / 1000) * 1000);

/** Bearer <64 hex> → sesión vigente de un vecino activo. Marca "en línea" (RNF-08). */
export const requireAuth: RequestHandler = async (req, _res, next) => {
    const token = /^Bearer ([0-9a-f]{64})$/i.exec(req.get('authorization') ?? '')?.[1];
    if (!token) throw new HttpError(401, 'Falta el token de sesión.');

    const tokenHash = sha256(token.toLowerCase());
    const [fila] = await db
        .select({ id: vecinos.id, rol: vecinos.rol, ultimoAcceso: vecinos.ultimoAcceso })
        .from(sesiones)
        .innerJoin(vecinos, eq(vecinos.id, sesiones.vecinoId))
        .where(and(eq(sesiones.tokenHash, tokenHash), gt(sesiones.expiraEn, sql`UTC_TIMESTAMP()`), eq(vecinos.activo, true)))
        .limit(1);
    if (!fila) throw new HttpError(401, 'Sesión vencida. Volvé a iniciar sesión.');

    // Como mucho una escritura por minuto: la pantalla de alerta hace polling cada 2 s (RNF-06).
    if (!fila.ultimoAcceso || Date.now() - fila.ultimoAcceso.getTime() > 60_000) {
        await db.update(vecinos).set({ ultimoAcceso: sql`UTC_TIMESTAMP()` }).where(eq(vecinos.id, fila.id));
    }
    req.vecino = { id: fila.id, rol: fila.rol, tokenHash };
    next();
};

export const requireComite: RequestHandler = (req, _res, next) => {
    if (req.vecino.rol !== 'comite') throw new HttpError(403, 'Solo el comité puede hacer esto.');
    next();
};

/** Crea una sesión de 24 h y devuelve el JSON de la spec §3.2 (token, expira_en, vecino). */
export async function crearSesion(vecinoId: number) {
    const token = tokenAleatorio();
    const expiraEn = sinMs(Date.now() + SESION_MS);
    // De paso limpia las sesiones vencidas de este vecino: la tabla no crece sin límite.
    await db.delete(sesiones).where(and(eq(sesiones.vecinoId, vecinoId), lt(sesiones.expiraEn, sql`UTC_TIMESTAMP()`)));
    await db.insert(sesiones).values({ tokenHash: sha256(token), vecinoId, expiraEn });
    await db.update(vecinos).set({ ultimoAcceso: sql`UTC_TIMESTAMP()` }).where(eq(vecinos.id, vecinoId));

    const [v] = await db
        .select({ id: vecinos.id, nombre: vecinos.nombre, apellido: vecinos.apellido, manzana: manzanas.nombre, rol: vecinos.rol })
        .from(vecinos)
        .innerJoin(manzanas, eq(manzanas.id, vecinos.manzanaId))
        .where(eq(vecinos.id, vecinoId));
    return {
        token,
        expira_en: iso(expiraEn),
        vecino: { id: v!.id, nombre: `${v!.nombre} ${v!.apellido}`, manzana: v!.manzana, rol: v!.rol },
    };
}

/**
 * Genera el enlace de un solo uso para elegir contraseña y lo manda por correo. Invalida los
 * enlaces anteriores del vecino: solo sirve el último que recibió.
 */
export async function enviarEnlaceClave(
    vecino: { id: number; nombre: string; email: string },
    tipo: 'invitacion' | 'recuperacion',
): Promise<void> {
    const token = tokenAleatorio();
    await db.transaction(async (tx) => {
        await tx.delete(tokensClave).where(eq(tokensClave.vecinoId, vecino.id));
        await tx.insert(tokensClave).values({
            tokenHash: sha256(token),
            vecinoId: vecino.id,
            tipo,
            expiraEn: sinMs(Date.now() + VIGENCIA_TOKEN_MS[tipo]),
        });
    });

    const enlace = `${config.appUrlClave}?token=${token}`;
    await enviarCorreo(
        tipo === 'invitacion'
            ? correo(vecino.email, 'Te invitaron a VigiaApp', {
                  titulo: `¡Hola ${vecino.nombre}!`,
                  parrafos: [
                      'El comité del barrio te sumó a la red de VigiaApp.',
                      'Abrí este enlace desde tu celular (con la app instalada) para elegir tu contraseña. Vence en 7 días.',
                  ],
                  boton: { texto: 'Elegir mi contraseña', url: enlace },
                  pie: 'Si no esperabas este correo, ignoralo.',
              })
            : correo(vecino.email, 'Restablecer tu contraseña de VigiaApp', {
                  titulo: `Hola ${vecino.nombre}:`,
                  parrafos: ['Para elegir una contraseña nueva abrí este enlace desde tu celular. Vence en 1 hora.'],
                  boton: { texto: 'Cambiar mi contraseña', url: enlace },
                  pie: 'Si no lo pediste, ignoralo: tu contraseña actual sigue funcionando.',
              }),
    );
}
