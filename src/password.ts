// Contraseñas con crypto.scrypt (portado de SentidoBiologico, lib/passwordHash.ts): corre en el
// threadpool de libuv y no bloquea el event loop, a diferencia de bcryptjs.
import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';

const N = 32768;
const R = 8;
const P = 1;
const KEYLEN = 64;
const MAXMEM = 96 * 1024 * 1024; // 128·N·r = 32 MiB por hash; el default de Node (32 MiB) no alcanza

function derivar(plano: string, salt: Buffer, keylen: number, opciones: ScryptOptions): Promise<Buffer> {
    return new Promise((resolve, reject) =>
        scrypt(plano, salt, keylen, opciones, (err, clave) => (err ? reject(err) : resolve(clave))),
    );
}

/** Formato autodescriptivo `scrypt$N$r$p$salt$hash`: los parámetros pueden cambiar sin invalidar los viejos. */
export async function hashPassword(plano: string): Promise<string> {
    const salt = randomBytes(16);
    const hash = await derivar(plano, salt, KEYLEN, { N, r: R, p: P, maxmem: MAXMEM });
    return ['scrypt', N, R, P, salt.toString('base64'), hash.toString('base64')].join('$');
}

/** Un hash con formato desconocido cuenta como contraseña incorrecta, no como error 500. */
export async function verifyPassword(plano: string, guardado: string | null | undefined): Promise<boolean> {
    const partes = guardado?.split('$');
    if (!partes || partes.length !== 6 || partes[0] !== 'scrypt') return false;
    const [n, r, p] = partes.slice(1, 4).map(Number) as [number, number, number];
    // Acotados: un registro corrupto no debe poder pedir una derivación carísima.
    if (!(n >= 2 && n <= 1 << 20 && (n & (n - 1)) === 0 && r >= 1 && r <= 32 && p >= 1 && p <= 16)) return false;
    const salt = Buffer.from(partes[4]!, 'base64');
    const esperado = Buffer.from(partes[5]!, 'base64');
    if (!salt.length || !esperado.length) return false;
    const hash = await derivar(plano, salt, esperado.length, { N: n, r, p, maxmem: Math.max(MAXMEM, 256 * n * r) });
    return timingSafeEqual(hash, esperado);
}

let dummy: Promise<string> | null = null;

/** Hash sin dueño: se verifica contra él cuando el email no existe, para que el tiempo no lo delate. */
export function hashFicticio(): Promise<string> {
    dummy ??= hashPassword(randomBytes(24).toString('hex'));
    return dummy;
}
