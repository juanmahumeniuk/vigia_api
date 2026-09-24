import nodemailer from 'nodemailer';
import { config } from './config.ts';

export type Correo = { para: string; asunto: string; texto: string; html?: string };

/** Contenido de un correo o de una página: de acá salen la versión HTML y la de texto plano. */
export type Contenido = { titulo: string; parrafos: string[]; boton?: { texto: string; url: string }; pie?: string };

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

const esc = (s: string) =>
    s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/**
 * Misma estética que la app (Material 3 con semilla indigo, escudo, "Red de alerta vecinal").
 * Tablas y estilos en línea porque los clientes de correo ignoran <style> y flexbox.
 */
export function html(c: Contenido): string {
    const p = (t: string) => `<p style="margin:0 0 16px;font-size:16px;line-height:1.5;color:#1b1b21">${esc(t)}</p>`;
    const boton = c.boton
        ? `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:8px auto 24px"><tr><td style="border-radius:20px;background:#3f51b5">
<a href="${esc(c.boton.url)}" style="display:inline-block;padding:12px 28px;font-size:16px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:20px">${esc(c.boton.texto)}</a>
</td></tr></table>
<p style="margin:0 0 16px;font-size:13px;line-height:1.5;color:#46464f">Si el botón no funciona, copiá este enlace:<br><a href="${esc(c.boton.url)}" style="color:#3f51b5;word-break:break-all">${esc(c.boton.url)}</a></p>`
        : '';
    const pie = c.pie ? `<p style="margin:16px 0 0;font-size:13px;line-height:1.5;color:#46464f">${esc(c.pie)}</p>` : '';
    return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(c.titulo)}</title></head>
<body style="margin:0;padding:0;background:#f4f5fb;font-family:Roboto,'Segoe UI',Arial,sans-serif">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f5fb"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:480px">
<tr><td align="center" style="padding-bottom:24px">
<div style="font-size:40px;line-height:1">&#128737;&#65039;</div>
<div style="font-size:24px;font-weight:600;color:#3f51b5;margin-top:8px">VigiaApp</div>
<div style="font-size:14px;color:#46464f">Red de alerta vecinal</div>
</td></tr>
<tr><td style="background:#ffffff;border-radius:16px;padding:32px 24px;border:1px solid #dee0ff">
<h1 style="margin:0 0 16px;font-size:20px;font-weight:600;color:#1b1b21">${esc(c.titulo)}</h1>
${c.parrafos.map(p).join('\n')}
${boton}${pie}
</td></tr>
</table></td></tr></table></body></html>`;
}

/** Arma el correo con las dos versiones: HTML y texto plano (para clientes que no muestran HTML). */
export function correo(para: string, asunto: string, c: Contenido): Correo {
    const texto = [c.titulo, ...c.parrafos, c.boton ? `${c.boton.texto}: ${c.boton.url}` : '', c.pie ?? '']
        .filter(Boolean)
        .join('\n\n');
    return { para, asunto, texto, html: html(c) };
}

export async function enviarCorreo(correo: Correo): Promise<void> {
    if (!transporte || !config.smtp) {
        bandeja.push(correo);
        if (process.env.NODE_ENV !== 'test') console.log(`[mail] (sin SMTP) para ${correo.para}: ${correo.asunto}\n${correo.texto}`);
        return;
    }
    await transporte.sendMail({ from: config.smtp.from, to: correo.para, subject: correo.asunto, text: correo.texto, html: correo.html });
}

/**
 * Para avisos que no deben tumbar la petición (p. ej. "vecino ausente" al comité): si el SMTP
 * falla se loguea y listo, la respuesta del vecino ya quedó guardada.
 */
export function enviarSinEsperar(correo: Correo): void {
    enviarCorreo(correo).catch((e) => console.error('[mail] envío fallido:', e?.message));
}
