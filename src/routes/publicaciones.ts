// Feed de actividad (RF-05), noticias del comité (RF-06) y sus respuestas.
import { Router } from 'express';
import { and, asc, desc, eq, sql, type SQL } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { ETIQUETAS, publicaciones, publicacionRespuestas, TIPOS_PUBLICACION, vecinos } from '../db/schema.ts';
import { errnoMysql, HttpError, invalido, noEncontrado } from '../errors.ts';
import * as validar from '../validar.ts';

export const rutasPublicaciones = Router();

/** "María R." y "MR", como en la spec §4.3. */
const autor = (v: { nombre: string; apellido: string }) => ({
    autor: `${v.nombre} ${v.apellido.charAt(0)}.`,
    iniciales: `${v.nombre.charAt(0)}${v.apellido.charAt(0)}`.toUpperCase(),
});

async function buscarPublicaciones(where: SQL | undefined, limite: number) {
    const filas = await db
        .select({
            id: publicaciones.id,
            tipo: publicaciones.tipo,
            titulo: publicaciones.titulo,
            cuerpo: publicaciones.cuerpo,
            etiqueta: publicaciones.etiqueta,
            firma: publicaciones.firma,
            autorId: publicaciones.autorId,
            nombre: vecinos.nombre,
            apellido: vecinos.apellido,
            creadoEn: publicaciones.creadoEn,
            // Calculado: la columna `respuestas` de la spec podía desfasarse del conteo real.
            respuestas: sql<number>`(SELECT COUNT(*) FROM ${publicacionRespuestas} WHERE ${publicacionRespuestas.publicacionId} = ${publicaciones.id})`.mapWith(Number),
        })
        .from(publicaciones)
        .innerJoin(vecinos, eq(vecinos.id, publicaciones.autorId))
        .where(where)
        .orderBy(desc(publicaciones.creadoEn), desc(publicaciones.id))
        .limit(limite);
    return filas.map((p) => {
        const a = autor(p);
        return {
            id: p.id,
            tipo: p.tipo,
            titulo: p.titulo,
            cuerpo: p.cuerpo,
            etiqueta: p.etiqueta,
            autor: p.firma ?? a.autor,
            iniciales: a.iniciales,
            autor_id: p.autorId,
            creado_en: validar.iso(p.creadoEn),
            respuestas: p.respuestas,
        };
    });
}

async function publicacionPorId(id: number) {
    const [p] = await buscarPublicaciones(eq(publicaciones.id, id), 1);
    if (!p) throw noEncontrado('La publicación no existe.');
    return p;
}

rutasPublicaciones.get('/publicaciones', async (req, res) => {
    const tipo = validar.unoDe(req.query.tipo, TIPOS_PUBLICACION, 'tipo');
    const etiqueta = req.query.etiqueta === undefined ? null : validar.unoDe(req.query.etiqueta, ETIQUETAS, 'etiqueta');
    const filtro = and(eq(publicaciones.tipo, tipo), etiqueta ? eq(publicaciones.etiqueta, etiqueta) : undefined);
    // El listado no trae `cuerpo`: se pide con GET /publicaciones/{id}.
    res.json((await buscarPublicaciones(filtro, 50)).map(({ cuerpo: _c, ...p }) => p));
});

rutasPublicaciones.get('/publicaciones/:id', async (req, res) => {
    res.json(await publicacionPorId(validar.id(req.params.id)));
});

rutasPublicaciones.post('/publicaciones', async (req, res) => {
    const b = req.body ?? {};
    const tipo = validar.unoDe(b.tipo, TIPOS_PUBLICACION, 'tipo');
    const etiqueta = b.etiqueta == null ? null : validar.unoDe(b.etiqueta, ETIQUETAS, 'etiqueta');
    const firma = validar.textoOpcional(b.firma, 'firma', 40);
    if ((tipo === 'noticia' || firma) && req.vecino.rol !== 'comite') {
        throw new HttpError(403, 'Solo el comité publica noticias o firma en nombre de otros.');
    }
    if (tipo === 'actividad' && etiqueta) throw invalido('Las actividades no llevan etiqueta.');
    if (tipo === 'noticia' && !etiqueta) throw invalido('Las noticias llevan etiqueta.');

    const [r] = await db
        .insert(publicaciones)
        .values({
            autorId: req.vecino.id,
            tipo,
            etiqueta,
            firma,
            titulo: validar.texto(b.titulo, 'titulo', 140),
            cuerpo: validar.textoOpcional(b.cuerpo, 'cuerpo', 5000),
        })
        .$returningId();
    res.status(201).json(await publicacionPorId(r!.id));
});

rutasPublicaciones.delete('/publicaciones/:id', async (req, res) => {
    const p = await publicacionPorId(validar.id(req.params.id));
    if (p.autor_id !== req.vecino.id && req.vecino.rol !== 'comite') {
        throw new HttpError(403, 'Solo el autor o el comité pueden borrarla.');
    }
    await db.delete(publicaciones).where(eq(publicaciones.id, p.id));
    res.status(204).end();
});

// --- Respuestas ---

async function buscarRespuestas(where: SQL) {
    const filas = await db
        .select({
            id: publicacionRespuestas.id,
            texto: publicacionRespuestas.texto,
            autorId: publicacionRespuestas.autorId,
            nombre: vecinos.nombre,
            apellido: vecinos.apellido,
            creadoEn: publicacionRespuestas.creadoEn,
        })
        .from(publicacionRespuestas)
        .innerJoin(vecinos, eq(vecinos.id, publicacionRespuestas.autorId))
        .where(where)
        .orderBy(asc(publicacionRespuestas.creadoEn), asc(publicacionRespuestas.id))
        .limit(200);
    return filas.map((r) => ({ id: r.id, texto: r.texto, ...autor(r), autor_id: r.autorId, creado_en: validar.iso(r.creadoEn) }));
}

rutasPublicaciones.get('/publicaciones/:id/respuestas', async (req, res) => {
    const p = await publicacionPorId(validar.id(req.params.id));
    res.json(await buscarRespuestas(eq(publicacionRespuestas.publicacionId, p.id)));
});

rutasPublicaciones.post('/publicaciones/:id/respuestas', async (req, res) => {
    const publicacionId = validar.id(req.params.id);
    const texto = validar.texto(req.body?.texto, 'texto', 500);
    const [r] = await db
        .insert(publicacionRespuestas)
        .values({ publicacionId, autorId: req.vecino.id, texto })
        .$returningId()
        .catch((e) => {
            throw errnoMysql(e) === 1452 ? noEncontrado('La publicación no existe.') : e;
        });
    const [respuesta] = await buscarRespuestas(eq(publicacionRespuestas.id, r!.id));
    res.status(201).json(respuesta);
});
