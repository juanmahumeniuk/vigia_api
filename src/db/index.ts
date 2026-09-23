import mysql from 'mysql2/promise';
import { drizzle } from 'drizzle-orm/mysql2';
import { config } from '../config.ts';
import * as schema from './schema.ts';

export const pool = mysql.createPool({
    uri: config.databaseUrl,
    connectionLimit: config.dbPoolLimit,
    enableKeepAlive: true,
    keepAliveInitialDelay: 10_000,
    timezone: 'Z', // el driver lee y escribe DATETIME en UTC
    decimalNumbers: true, // SUM()/DECIMAL como number, no como string
    charset: 'utf8mb4_unicode_ci',
});

// Todo en UTC (spec §1): sin esto, DEFAULT CURRENT_TIMESTAMP y UTC_TIMESTAMP() no coinciden
// si el servidor MySQL está en otra zona. Se encola antes de cualquier consulta de la conexión.
pool.on('connection', (conn) => {
    conn.query("SET time_zone = '+00:00'");
});

export const db = drizzle(pool, { schema, mode: 'default' });
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
