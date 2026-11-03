// Fotos de publicaciones, mensajes y alertas. Se suben solas (POST /fotos con los bytes crudos) y
// después se asocian mandando `foto_id` en el body de la publicación, el mensaje o la alerta.
import express, { Router } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { fotos } from '../db/schema.ts';
import { HttpError, invalido, noEncontrado } from '../errors.ts';
import * as validar from '../validar.ts';

export const rutasFotos = Router();

/** Tipo real según los primeros bytes: no se confía en el Content-Type que manda el cliente. */
export function tipoImagen(b: Buffer): string | null {
    if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
    if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
    if (b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
    return null;
}

/** `foto_id` opcional de un body: tiene que existir y haberla subido quien la asocia. */
export async function fotoPropia(valor: unknown, vecinoId: number): Promise<number | null> {
    if (valor === undefined || valor === null) return null;
    const id = validar.id(valor, 'foto_id');
    const [f] = await db.select({ vecinoId: fotos.vecinoId }).from(fotos).where(eq(fotos.id, id));
    if (!f) throw noEncontrado('La foto no existe.');
    if (f.vecinoId !== vecinoId) throw new HttpError(403, 'Solo podés usar fotos que subiste vos.');
    return id;
}

// El parser global solo lee JSON (10 kb): este acepta hasta 3 MB de imagen, solo en esta ruta.
rutasFotos.post('/fotos', express.raw({ type: 'image/*', limit: '3mb' }), async (req, res) => {
    const datos: Buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const mime = tipoImagen(datos);
    if (!mime) throw invalido('La foto tiene que ser JPEG, PNG o WEBP.');
    const [r] = await db.insert(fotos).values({ vecinoId: req.vecino.id, mime, datos }).$returningId();
    res.status(201).json({ id: r!.id });
});

rutasFotos.get('/fotos/:id', async (req, res) => {
    const [f] = await db
        .select({ mime: fotos.mime, datos: fotos.datos })
        .from(fotos)
        .where(eq(fotos.id, validar.id(req.params.id)));
    if (!f) throw noEncontrado('La foto no existe.');
    // Una foto no cambia nunca: el celular puede guardarla un día.
    res.set('Cache-Control', 'private, max-age=86400').type(f.mime).send(f.datos);
});
