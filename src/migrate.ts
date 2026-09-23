// Aplica las migraciones de drizzle/ que falten. Lo corre el build de Hostinger (`npm run db:migrate`).
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/mysql2/migrator';
import { db, pool } from './db/index.ts';

// Desde src/ o desde dist/src/, la carpeta drizzle/ está en la raíz del proyecto.
const raiz = fileURLToPath(new URL(import.meta.url.includes('/dist/') ? '../../' : '../', import.meta.url));

export const migrar = () => migrate(db, { migrationsFolder: `${raiz}drizzle` });

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    await migrar();
    console.log('[migrate] base al día');
    await pool.end();
}
