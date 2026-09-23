import nodemailer from 'nodemailer';
import { config } from './config.ts';

export type Correo = { para: string; asunto: string; texto: string };

/** Sin SMTP (desarrollo y tests) los correos quedan acá y en la consola. */
export const bandeja: Correo[] = [];

const transporte = config.smtp
    ? nodemailer.createTransport({
          host: config.smtp.host,
          port: config.smtp.port,
          secure: config.smtp.secure,
          auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
      })
    : null;

export async function enviarCorreo(correo: Correo): Promise<void> {
    if (!transporte || !config.smtp) {
        bandeja.push(correo);
        if (process.env.NODE_ENV !== 'test') console.log(`[mail] (sin SMTP) para ${correo.para}: ${correo.asunto}\n${correo.texto}`);
        return;
    }
    await transporte.sendMail({ from: config.smtp.from, to: correo.para, subject: correo.asunto, text: correo.texto });
}

/**
 * Para avisos que no deben tumbar la petición (p. ej. "vecino ausente" al comité): si el SMTP
 * falla se loguea y listo, la respuesta del vecino ya quedó guardada.
 */
export function enviarSinEsperar(correo: Correo): void {
    enviarCorreo(correo).catch((e) => console.error('[mail] envío fallido:', e?.message));
}
