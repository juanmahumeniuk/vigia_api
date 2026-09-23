// Validación de entradas en el borde de la API. Cada función devuelve el valor ya normalizado
// o lanza 400 datos_invalidos con un mensaje que la app puede mostrar tal cual.
import { invalido } from './errors.ts';

export function texto(valor: unknown, campo: string, max: number): string {
    const limpio = typeof valor === 'string' ? valor.trim() : '';
    if (!limpio) throw invalido(`Falta ${campo}.`);
    if (limpio.length > max) throw invalido(`${campo} admite hasta ${max} caracteres.`);
    return limpio;
}

export function textoOpcional(valor: unknown, campo: string, max: number): string | null {
    return valor === undefined || valor === null || valor === '' ? null : texto(valor, campo, max);
}

export function email(valor: unknown): string {
    const limpio = texto(valor, 'email', 254).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(limpio)) throw invalido('El email no es válido.');
    return limpio;
}

export function password(valor: unknown, campo = 'password'): string {
    // Sin trim: los espacios son parte de la contraseña. Tope en 128 para acotar el costo de scrypt.
    if (typeof valor !== 'string' || valor.length < 8 || valor.length > 128) {
        throw invalido(`${campo} debe tener entre 8 y 128 caracteres.`);
    }
    return valor;
}

export function telefono(valor: unknown): string | null {
    const limpio = textoOpcional(valor, 'telefono', 20)?.replace(/[\s-]/g, '') ?? null;
    if (limpio !== null && !/^\+[1-9]\d{7,14}$/.test(limpio)) {
        throw invalido('El teléfono va en formato internacional, por ejemplo +5491100000001.');
    }
    return limpio;
}

export function booleano(valor: unknown, campo: string): boolean {
    if (typeof valor !== 'boolean') throw invalido(`${campo} debe ser true o false.`);
    return valor;
}

export function id(valor: unknown, campo = 'id'): number {
    const n = typeof valor === 'number' ? valor : /^\d+$/.test(String(valor)) ? Number(valor) : NaN;
    if (!Number.isSafeInteger(n) || n < 1 || n > 4294967295) throw invalido(`${campo} no es un identificador válido.`);
    return n;
}

export function ids(valor: unknown, campo: string): number[] {
    if (!Array.isArray(valor)) throw invalido(`${campo} debe ser una lista de ids.`);
    return [...new Set(valor.map((v) => id(v, campo)))];
}

export function unoDe<T extends string>(valor: unknown, opciones: readonly T[], campo: string): T {
    if (!opciones.includes(valor as T)) throw invalido(`${campo} debe ser uno de: ${opciones.join(', ')}.`);
    return valor as T;
}

export function fecha(valor: unknown, campo: string): string {
    const s = String(valor ?? '');
    const d = new Date(`${s}T00:00:00Z`);
    // El round-trip descarta fechas imposibles como 2026-02-30.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) {
        throw invalido(`${campo} debe tener formato AAAA-MM-DD.`);
    }
    return s;
}

export function hora(valor: unknown, campo: string): string {
    const s = String(valor ?? '');
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(s)) throw invalido(`${campo} debe tener formato HH:MM.`);
    return `${s}:00`;
}

export function coordenada(valor: unknown, campo: string, limite: number): number | null {
    if (valor === null || valor === undefined) return null;
    if (typeof valor !== 'number' || !Number.isFinite(valor) || Math.abs(valor) > limite) {
        throw invalido(`${campo} debe ser null o un número entre -${limite} y ${limite}.`);
    }
    return Math.round(valor * 1e6) / 1e6;
}

/** ISO-8601 en UTC sin milisegundos, como en la spec: 2026-09-23T18:35:00Z. */
export const iso = (d: Date | null) => (d ? d.toISOString().replace(/\.\d{3}Z$/, 'Z') : null);
