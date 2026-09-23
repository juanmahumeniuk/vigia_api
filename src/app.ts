import express from 'express';
import helmet from 'helmet';
import { requireAuth } from './auth.ts';
import { config } from './config.ts';
import { pool } from './db/index.ts';
import { manejarError, rutaInexistente } from './errors.ts';
import { rutasAlertas } from './routes/alertas.ts';
import { rutasAuth } from './routes/auth.ts';
import { rutasBarrio } from './routes/barrio.ts';
import { rutasPublicaciones } from './routes/publicaciones.ts';
import { rutasRondines } from './routes/rondines.ts';
import { rutasVecinos } from './routes/vecinos.ts';

export const app = express();

// Detrás del proxy de Hostinger: sin esto, el rate limit ve la IP del proxy y no la del cliente.
if (config.trustProxy) app.set('trust proxy', config.trustProxy);
app.disable('x-powered-by');
app.use(helmet());
app.use(express.json({ limit: '10kb' }));

/** Liveness: sin dependencias, para que un hipo de MySQL no provoque reinicios en bucle. */
app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
});

/** Readiness: además de vivo, llega a la base. */
app.get('/health/ready', async (_req, res) => {
    try {
        await pool.query('SELECT 1');
        res.json({ status: 'ok', db: 'up' });
    } catch {
        res.status(503).json({ status: 'error', db: 'down' });
    }
});

const api = express.Router();
api.use('/auth', rutasAuth);
api.use(requireAuth); // todo lo que sigue exige Authorization: Bearer <token>
api.use(rutasVecinos, rutasBarrio, rutasPublicaciones, rutasRondines, rutasAlertas);
app.use('/api/v1', api);

app.use(rutaInexistente);
app.use(manejarError);
