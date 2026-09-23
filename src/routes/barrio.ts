import { Router } from 'express';
import { count, eq, sql } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { vecinos } from '../db/schema.ts';

export const rutasBarrio = Router();

/** RF-04. "En línea" = alguna petición autenticada en los últimos 5 minutos (RNF-08). */
rutasBarrio.get('/barrio/estado', async (_req, res) => {
    const [r] = await db
        .select({
            vecinos_en_linea: sql<number>`COALESCE(SUM(${vecinos.ultimoAcceso} >= UTC_TIMESTAMP() - INTERVAL 5 MINUTE), 0)`.mapWith(Number),
            vecinos_total: count(),
        })
        .from(vecinos)
        .where(eq(vecinos.activo, true));
    res.json(r);
});
