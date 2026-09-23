import type { ErrorRequestHandler, RequestHandler } from 'express';

// Formato único de error (spec §3.1): { "error": { "codigo": "...", "mensaje": "..." } }
const CODIGOS = {
    400: 'datos_invalidos',
    401: 'no_autorizado',
    403: 'prohibido',
    404: 'no_encontrado',
    409: 'conflicto',
    429: 'demasiados_intentos',
    500: 'error_interno',
} as const;

type Status = keyof typeof CODIGOS;

export class HttpError extends Error {
    readonly status: Status;
    constructor(status: Status, mensaje: string) {
        super(mensaje);
        this.status = status;
    }
}

export const invalido = (mensaje: string) => new HttpError(400, mensaje);
export const noEncontrado = (mensaje = 'No existe.') => new HttpError(404, mensaje);
export const conflicto = (mensaje: string) => new HttpError(409, mensaje);

export function enviarError(res: Parameters<RequestHandler>[1], status: Status, mensaje: string) {
    res.status(status).json({ error: { codigo: CODIGOS[status], mensaje } });
}

export const rutaInexistente: RequestHandler = (_req, res) => enviarError(res, 404, 'Ruta inexistente.');

/**
 * Último recurso. Los errores de cliente de body-parser (JSON mal formado, cuerpo muy grande) traen
 * su propio status 4xx. Lo demás es 500: se loguea solo el código y el mensaje del driver, nunca
 * `err.sql`, porque mysql2 lo trae con los parámetros ya interpolados (emails, hashes).
 */
export const manejarError: ErrorRequestHandler = (err, req, res, _next) => {
    if (err instanceof HttpError) {
        return enviarError(res, err.status, err.message);
    }
    const status = typeof err?.status === 'number' ? err.status : 500;
    if (status >= 400 && status < 500) {
        return enviarError(res, 400, 'El cuerpo de la petición no es JSON válido.');
    }
    const causa = err?.cause ?? err;
    console.error(`[error] ${req.method} ${req.path}`, { code: causa?.code, errno: causa?.errno, message: causa?.sqlMessage ?? causa?.message });
    if (!res.headersSent) {
        enviarError(res, 500, 'Error interno del servidor.');
    }
};

/** errno de MySQL, esté el error envuelto por Drizzle (`cause`) o no. 1062 = duplicado, 1452 = FK inexistente. */
export function errnoMysql(e: unknown): number | undefined {
    const err = e as { errno?: number; cause?: { errno?: number } };
    return err?.cause?.errno ?? err?.errno;
}
