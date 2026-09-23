import { app } from './app.ts';
import { config } from './config.ts';
import { pool } from './db/index.ts';

const server = app.listen(config.puerto, () => {
    console.log(`[vigia-api] escuchando en :${config.puerto} (/api/v1)`);
});

// Cierre ordenado: termina las peticiones en curso y libera las conexiones de MySQL.
for (const senal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(senal, () => {
        server.close(() => pool.end().finally(() => process.exit(0)));
        setTimeout(() => process.exit(1), 10_000).unref();
    });
}
