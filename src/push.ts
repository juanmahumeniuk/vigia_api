// Notificaciones push vía Firebase Cloud Messaging (FCM) para alertas SOS con la app cerrada.
// Sigue el mismo patrón que mail.ts: sin credenciales en .env, los avisos quedan en `bandejaPush`
// y en la consola para poder probar y desarrollar sin Firebase.
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getMessaging, type Messaging } from 'firebase-admin/messaging';
import { inArray } from 'drizzle-orm';
import { config } from './config.ts';
import { db } from './db/index.ts';
import { dispositivosPush } from './db/schema.ts';

export type AvisoPushAlerta = {
    alertaId: number;
    vecinoNombre: string;
    manzana: string;
    tokens: string[];
};

/** Sin credenciales Firebase (desarrollo y tests) los push quedan acá y en la consola. */
export const bandejaPush: AvisoPushAlerta[] = [];

const CODIGOS_TOKEN_INVALIDO = new Set([
    'messaging/registration-token-not-registered',
    'messaging/invalid-registration-token',
]);

let mensajeria: Messaging | null = null;
if (config.firebase) {
    const app =
        getApps()[0] ??
        initializeApp({
            credential: cert({
                projectId: config.firebase.projectId,
                clientEmail: config.firebase.clientEmail,
                privateKey: config.firebase.privateKey,
            }),
        });
    mensajeria = getMessaging(app);
}

/**
 * Envía el push de alerta SOS a los tokens indicados (en lotes de 500, límite de FCM).
 * Si FCM informa tokens vencidos o desinstalados, los borra de `dispositivos_push`.
 */
export async function enviarPushAlerta(aviso: AvisoPushAlerta): Promise<void> {
    if (aviso.tokens.length === 0) return;

    if (!mensajeria) {
        bandejaPush.push(aviso);
        if (process.env.NODE_ENV !== 'test') {
            console.log(
                `[push] (sin Firebase) alerta #${aviso.alertaId} de ${aviso.vecinoNombre} (${aviso.manzana}) → ${aviso.tokens.length} dispositivo(s)`,
            );
        }
        return;
    }

    const title = `SOS · ${aviso.vecinoNombre} · ${aviso.manzana}`;
    const body = 'Tocá para ver dónde está y avisar si vas.';
    const invalidos: string[] = [];

    for (let i = 0; i < aviso.tokens.length; i += 500) {
        const lote = aviso.tokens.slice(i, i + 500);
        const respuesta = await mensajeria.sendEachForMulticast({
            tokens: lote,
            notification: { title, body },
            data: {
                tipo: 'alerta_sos',
                alerta_id: String(aviso.alertaId),
                vecino_nombre: aviso.vecinoNombre,
                manzana: aviso.manzana,
            },
            android: {
                priority: 'high',
                notification: {
                    channelId: 'alertas_sos',
                    tag: `alerta_${aviso.alertaId}`,
                    sound: 'default',
                },
            },
        });
        respuesta.responses.forEach((r, idx) => {
            if (!r.success && r.error && CODIGOS_TOKEN_INVALIDO.has(r.error.code)) {
                invalidos.push(lote[idx]!);
            }
        });
    }

    if (invalidos.length > 0) {
        await db.delete(dispositivosPush).where(inArray(dispositivosPush.token, invalidos));
    }
}

/**
 * Envío en segundo plano: un error de FCM nunca debe demorar ni tumbar el POST /alertas.
 */
export function enviarPushSinEsperar(aviso: AvisoPushAlerta): void {
    enviarPushAlerta(aviso).catch((e) => console.error('[push] envío fallido:', e?.message));
}
