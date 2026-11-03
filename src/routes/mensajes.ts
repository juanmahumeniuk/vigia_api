// Chat general del barrio (Inicio de la app). Sin WebSockets en el hosting: la app hace polling con
// ?despues=<id del último mensaje que tiene> y recibe solo los nuevos.
import { Router } from 'express';
import { asc, desc, eq, gt, type SQL } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { mensajes, vecinos } from '../db/schema.ts';
import { invalido } from '../errors.ts';
import * as validar from '../validar.ts';
import { fotoPropia } from './fotos.ts';
import { autor } from './publicaciones.ts';

export const rutasMensajes = Router();

/** Hasta 50, siempre del más viejo al más nuevo. `ultimos` = los 50 más recientes. */
async function buscarMensajes(where: SQL | undefined, ultimos: boolean) {
    const filas = await db
        .select({
            id: mensajes.id,
            texto: mensajes.texto,
            fotoId: mensajes.fotoId,
            autorId: mensajes.autorId,
            nombre: vecinos.nombre,
            apellido: vecinos.apellido,
            creadoEn: mensajes.creadoEn,
        })
        .from(mensajes)
        .innerJoin(vecinos, eq(vecinos.id, mensajes.autorId))
        .where(where)
        .orderBy(ultimos ? desc(mensajes.id) : asc(mensajes.id))
        .limit(50);
    if (ultimos) filas.reverse();
    return filas.map((m) => ({
        id: m.id,
        texto: m.texto,
        foto_id: m.fotoId,
        ...autor(m),
        autor_id: m.autorId,
        creado_en: validar.iso(m.creadoEn),
    }));
}

rutasMensajes.get('/mensajes', async (req, res) => {
    if (req.query.despues === undefined) return res.json(await buscarMensajes(undefined, true));
    const despues = validar.id(req.query.despues, 'despues');
    res.json(await buscarMensajes(gt(mensajes.id, despues), false));
});

rutasMensajes.post('/mensajes', async (req, res) => {
    const texto = validar.textoOpcional(req.body?.texto, 'texto', 500);
    const fotoId = await fotoPropia(req.body?.foto_id, req.vecino.id);
    if (texto === null && fotoId === null) throw invalido('El mensaje necesita texto o una foto.');
    const [r] = await db.insert(mensajes).values({ autorId: req.vecino.id, texto, fotoId }).$returningId();
    const [mensaje] = await buscarMensajes(eq(mensajes.id, r!.id), false);
    res.status(201).json(mensaje);
});
