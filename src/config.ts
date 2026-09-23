// Única lectura de variables de entorno. Falla al arrancar si falta algo obligatorio,
// en vez de fallar en la primera petición que lo necesite.

const esProduccion = process.env.NODE_ENV === 'production';

function requerida(nombre: string): string {
    const valor = process.env[nombre]?.trim();
    if (!valor) {
        throw new Error(`Falta la variable de entorno ${nombre}.`);
    }
    return valor;
}

const smtpHost = process.env.SMTP_HOST?.trim() || null;
if (esProduccion && !smtpHost) {
    throw new Error('Falta SMTP_HOST: en producción las invitaciones tienen que salir por correo.');
}

export const config = {
    esProduccion,
    puerto: Number(process.env.PORT) || 3000,
    databaseUrl: requerida('DATABASE_URL'),
    dbPoolLimit: Number(process.env.DB_POOL_LIMIT) || 5,
    trustProxy: Number(process.env.TRUST_PROXY) || 0,
    barrioTz: process.env.BARRIO_TZ?.trim() || 'America/Argentina/Buenos_Aires',
    appUrlClave: esProduccion ? requerida('APP_URL_CLAVE') : process.env.APP_URL_CLAVE?.trim() || 'vigiaapp://clave',
    authRateLimitMax: Number(process.env.AUTH_RATE_LIMIT_MAX) || 20,
    smtp: smtpHost
        ? {
              host: smtpHost,
              port: Number(process.env.SMTP_PORT) || 465,
              secure: process.env.SMTP_SECURE !== 'false',
              user: process.env.SMTP_USER?.trim() ?? '',
              pass: process.env.SMTP_PASS ?? '',
              from: requerida('SMTP_FROM'),
          }
        : null,
};
