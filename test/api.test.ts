// Tests de integración: API real (app.listen(0)) contra una base MariaDB/MySQL de prueba.
// Requiere TEST_DATABASE_URL con un usuario que pueda crear la base: se BORRA y recrea en cada corrida.
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { AddressInfo } from 'node:net';
import mysql from 'mysql2/promise';
import { parse } from 'yaml';
import { readFile } from 'node:fs/promises';

const urlTest = process.env.TEST_DATABASE_URL;
if (!urlTest) throw new Error('Definí TEST_DATABASE_URL (ver .env.example).');
process.env.DATABASE_URL = urlTest;
process.env.NODE_ENV = 'test';
process.env.SMTP_HOST = '';
process.env.AUTH_RATE_LIMIT_MAX = '1000';

// Base limpia antes de importar la app (el pool se crea al importar src/db).
const servidorDb = new URL(urlTest);
const nombreDb = servidorDb.pathname.slice(1);
servidorDb.pathname = '/';
const admin = await mysql.createConnection(servidorDb.toString());
await admin.query(`DROP DATABASE IF EXISTS \`${nombreDb}\``);
await admin.query(`CREATE DATABASE \`${nombreDb}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
await admin.end();

const { app } = await import('../src/app.ts');
const { pool } = await import('../src/db/index.ts');
const { migrar } = await import('../src/migrate.ts');
const { bandeja } = await import('../src/mail.ts');
const { lunesDeEstaSemana } = await import('../src/routes/rondines.ts');
const { sembrar, PASSWORD_SEED } = await import('../scripts/seed.ts');

let base = '';
const server = app.listen(0);

type Respuesta = { status: number; body: any; headers: Headers };

async function pedir(metodo: string, ruta: string, opciones: { token?: string; body?: unknown } = {}): Promise<Respuesta> {
    const r = await fetch(base + ruta, {
        method: metodo,
        headers: {
            'Content-Type': 'application/json',
            ...(opciones.token ? { Authorization: `Bearer ${opciones.token}` } : {}),
        },
        body: opciones.body === undefined ? undefined : typeof opciones.body === 'string' ? opciones.body : JSON.stringify(opciones.body),
    });
    const texto = await r.text();
    return { status: r.status, body: texto ? JSON.parse(texto) : null, headers: r.headers };
}

async function login(usuario: string, password = PASSWORD_SEED): Promise<string> {
    const r = await pedir('POST', '/api/v1/auth/login', { body: { email: `${usuario}@vigia.test`, password } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    return r.body.token;
}

/** Espera (hasta 2 s) un correo que se manda sin await, en vez de un sleep fijo. */
async function esperarCorreo(condicion: (c: (typeof bandeja)[number]) => boolean, desde = 0) {
    for (let i = 0; i < 100 && !bandeja.slice(desde).some(condicion); i++) {
        await new Promise((r) => setTimeout(r, 20));
    }
}

/** Último enlace de clave mandado a un email (sin SMTP los correos quedan en `bandeja`). */
function tokenDelCorreo(email: string): string {
    const correo = bandeja.findLast((c) => c.para === email);
    const token = correo?.texto.match(/token=([0-9a-f]{64})/)?.[1];
    assert.ok(token, `no hay enlace para ${email}`);
    return token;
}

let maria = ''; // vigía, asignada al turno de hoy (seed)
let tomas = '';
let laura = ''; // comité
let jorge = '';

before(async () => {
    await migrar();
    await sembrar();
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    [maria, tomas, laura, jorge] = (await Promise.all(['maria', 'tomas', 'laura', 'jorge'].map((u) => login(u)))) as [string, string, string, string];
});

after(async () => {
    server.close();
    await pool.end();
});

describe('formato y sesión', () => {
    it('sin token → 401 con el formato de error de la spec y charset utf-8', async () => {
        const r = await pedir('GET', '/api/v1/barrio/estado');
        assert.equal(r.status, 401);
        assert.equal(r.body.error.codigo, 'no_autorizado');
        assert.match(r.headers.get('content-type')!, /application\/json; charset=utf-8/);
    });

    it('JSON mal formado → 400 datos_invalidos', async () => {
        const r = await pedir('POST', '/api/v1/auth/login', { body: '{roto' });
        assert.equal(r.status, 400);
        assert.equal(r.body.error.codigo, 'datos_invalidos');
    });

    it('login devuelve la sesión con el formato de la spec §3.2', async () => {
        const r = await pedir('POST', '/api/v1/auth/login', { body: { email: 'MARIA@vigia.test', password: PASSWORD_SEED } });
        assert.equal(r.status, 200);
        assert.match(r.body.token, /^[0-9a-f]{64}$/);
        assert.match(r.body.expira_en, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
        assert.deepEqual(r.body.vecino, { id: 1, nombre: 'María Ríos', manzana: 'Manzana 4', rol: 'vigia' });
    });

    it('contraseña incorrecta o email inexistente → 401 con el mismo mensaje', async () => {
        const a = await pedir('POST', '/api/v1/auth/login', { body: { email: 'maria@vigia.test', password: 'otra-cosa' } });
        const b = await pedir('POST', '/api/v1/auth/login', { body: { email: 'nadie@vigia.test', password: 'otra-cosa' } });
        assert.equal(a.status, 401);
        assert.equal(b.status, 401);
        assert.equal(a.body.error.mensaje, b.body.error.mensaje);
    });

    it('logout invalida el token', async () => {
        const token = await login('pedro');
        assert.equal((await pedir('POST', '/api/v1/auth/logout', { token })).status, 204);
        assert.equal((await pedir('GET', '/api/v1/yo', { token })).status, 401);
    });

    it('GET /yo devuelve el perfil', async () => {
        const r = await pedir('GET', '/api/v1/yo', { token: laura });
        assert.equal(r.status, 200);
        assert.equal(r.body.email, 'laura@vigia.test');
        assert.equal(r.body.rol, 'comite');
    });
});

describe('invitación y contraseña', () => {
    it('el comité da de alta un vecino, que activa la cuenta con el enlace del correo', async () => {
        const alta = await pedir('POST', '/api/v1/vecinos', {
            token: laura,
            body: { nombre: 'Nora', apellido: 'Vega', email: 'nora@vigia.test', manzana_id: 2 },
        });
        assert.equal(alta.status, 201, JSON.stringify(alta.body));
        assert.equal(alta.body.invitacion_pendiente, true);
        assert.equal(alta.body.invitacion_enviada, true);

        const token = tokenDelCorreo('nora@vigia.test');
        const corta = await pedir('POST', '/api/v1/auth/clave', { body: { token, password: 'corta' } });
        assert.equal(corta.status, 400);

        const activar = await pedir('POST', '/api/v1/auth/clave', { body: { token, password: 'una-clave-larga' } });
        assert.equal(activar.status, 200);
        assert.equal(activar.body.vecino.nombre, 'Nora Vega');

        // El enlace es de un solo uso.
        const otraVez = await pedir('POST', '/api/v1/auth/clave', { body: { token, password: 'una-clave-larga' } });
        assert.equal(otraVez.status, 400);
        await login('nora', 'una-clave-larga');

        const reenviar = await pedir('POST', `/api/v1/vecinos/${alta.body.id}/invitacion`, { token: laura });
        assert.equal(reenviar.status, 409);
    });

    it('email duplicado → 409; manzana inexistente → 400; vecino común → 403', async () => {
        const body = { nombre: 'X', apellido: 'Y', email: 'maria@vigia.test', manzana_id: 1 };
        assert.equal((await pedir('POST', '/api/v1/vecinos', { token: laura, body })).status, 409);
        assert.equal((await pedir('POST', '/api/v1/vecinos', { token: laura, body: { ...body, email: 'z@vigia.test', manzana_id: 99 } })).status, 400);
        const r = await pedir('POST', '/api/v1/vecinos', { token: maria, body });
        assert.equal(r.status, 403);
        assert.equal(r.body.error.codigo, 'prohibido');
    });

    it('recuperar: 204 siempre; el enlace cambia la clave y cierra las sesiones previas', async () => {
        assert.equal((await pedir('POST', '/api/v1/auth/recuperar', { body: { email: 'nadie@vigia.test' } })).status, 204);
        const previa = await login('diego');
        assert.equal((await pedir('POST', '/api/v1/auth/recuperar', { body: { email: 'diego@vigia.test' } })).status, 204);
        await esperarCorreo((c) => c.para === 'diego@vigia.test' && c.asunto.startsWith('Restablecer'));
        const r = await pedir('POST', '/api/v1/auth/clave', { body: { token: tokenDelCorreo('diego@vigia.test'), password: 'clave-nueva-1' } });
        assert.equal(r.status, 200);
        assert.equal((await pedir('GET', '/api/v1/yo', { token: previa })).status, 401);
    });

    it('cambiar la clave propia exige la actual', async () => {
        const token = await login('lucia');
        const mal = await pedir('POST', '/api/v1/yo/clave', { token, body: { actual: 'x', nueva: 'lucia-clave-2' } });
        assert.equal(mal.status, 400);
        const ok = await pedir('POST', '/api/v1/yo/clave', { token, body: { actual: PASSWORD_SEED, nueva: 'lucia-clave-2' } });
        assert.equal(ok.status, 204);
        await login('lucia', 'lucia-clave-2');
    });

    it('desactivar un vecino corta sus sesiones; el comité no puede desactivarse a sí mismo', async () => {
        const token = await login('ana');
        const r = await pedir('PATCH', '/api/v1/vecinos/4', { token: laura, body: { activo: false } });
        assert.equal(r.status, 200);
        assert.equal(r.body.activo, false);
        assert.equal((await pedir('GET', '/api/v1/yo', { token })).status, 401);
        assert.equal((await pedir('PATCH', '/api/v1/vecinos/5', { token: laura, body: { activo: false } })).status, 409);
        await pedir('PATCH', '/api/v1/vecinos/4', { token: laura, body: { activo: true } });
    });
});

describe('inicio y publicaciones', () => {
    it('GET /barrio/estado cuenta a los que se conectaron en los últimos 5 minutos', async () => {
        const r = await pedir('GET', '/api/v1/barrio/estado', { token: maria });
        assert.equal(r.status, 200);
        assert.equal(typeof r.body.vecinos_en_linea, 'number');
        assert.ok(r.body.vecinos_en_linea >= 4);
        assert.equal(r.body.vecinos_total, 10); // 9 del seed + Nora
    });

    it('actividad y noticias con el formato de la spec', async () => {
        const act = await pedir('GET', '/api/v1/publicaciones?tipo=actividad', { token: maria });
        assert.equal(act.status, 200);
        assert.deepEqual(
            { autor: act.body[0].autor, iniciales: act.body[0].iniciales, respuestas: act.body[0].respuestas },
            { autor: 'Jorge L.', iniciales: 'JL', respuestas: 0 },
        );
        const noticias = await pedir('GET', '/api/v1/publicaciones?tipo=noticia&etiqueta=seguridad', { token: maria });
        assert.equal(noticias.body.length, 1);
        assert.equal(noticias.body[0].autor, 'Comité');
        assert.equal((await pedir('GET', '/api/v1/publicaciones?tipo=noticia', { token: maria })).body.length, 3);
        assert.equal((await pedir('GET', '/api/v1/publicaciones?tipo=otra', { token: maria })).status, 400);
        assert.equal((await pedir('GET', '/api/v1/publicaciones?tipo=noticia&etiqueta=x', { token: maria })).status, 400);
    });

    it('crear actividad, responderla (contador calculado) y borrarla', async () => {
        const nueva = await pedir('POST', '/api/v1/publicaciones', { token: jorge, body: { tipo: 'actividad', titulo: 'Perro suelto en la plaza' } });
        assert.equal(nueva.status, 201);
        const resp = await pedir('POST', `/api/v1/publicaciones/${nueva.body.id}/respuestas`, { token: maria, body: { texto: 'Ya lo vi, es de Pedro.' } });
        assert.equal(resp.status, 201);
        assert.equal(resp.body.autor, 'María R.');
        assert.equal((await pedir('GET', `/api/v1/publicaciones/${nueva.body.id}`, { token: maria })).body.respuestas, 1);
        assert.equal((await pedir('GET', `/api/v1/publicaciones/${nueva.body.id}/respuestas`, { token: maria })).body.length, 1);
        assert.equal((await pedir('DELETE', `/api/v1/publicaciones/${nueva.body.id}`, { token: maria })).status, 403);
        assert.equal((await pedir('DELETE', `/api/v1/publicaciones/${nueva.body.id}`, { token: jorge })).status, 204);
        assert.equal((await pedir('POST', '/api/v1/publicaciones/99999/respuestas', { token: maria, body: { texto: 'hola' } })).status, 404);
    });

    it('solo el comité publica noticias', async () => {
        const body = { tipo: 'noticia', etiqueta: 'obras', titulo: 'Corte de agua el lunes' };
        assert.equal((await pedir('POST', '/api/v1/publicaciones', { token: maria, body })).status, 403);
        const r = await pedir('POST', '/api/v1/publicaciones', { token: laura, body: { ...body, firma: 'Comité' } });
        assert.equal(r.status, 201);
        assert.equal(r.body.autor, 'Comité');
        // NewsItem.fromJson exige etiqueta en las noticias.
        assert.equal((await pedir('POST', '/api/v1/publicaciones', { token: laura, body: { tipo: 'noticia', titulo: 'x' } })).status, 400);
    });
});

describe('rondines', () => {
    it('la semana trae 7 turnos desde el lunes, con pareja y mi_estado', async () => {
        const r = await pedir('GET', '/api/v1/rondines/semana', { token: maria });
        assert.equal(r.status, 200);
        assert.equal(r.body.length, 7);
        assert.equal(r.body[0].fecha, lunesDeEstaSemana());
        assert.deepEqual(r.body[2].pareja, ['María R.', 'Tomás R.']);
        assert.equal(r.body[2].mi_estado, 'pendiente');
        assert.equal(r.body[0].mi_estado, null);
        assert.equal(r.body[0].hora_inicio, '22:00');
        assert.equal((await pedir('GET', '/api/v1/rondines/semana?desde=2026-02-30', { token: maria })).status, 400);
    });

    it('asistencia: confirma, avisa al comité si falta y 404 si no está asignado', async () => {
        const semana = (await pedir('GET', '/api/v1/rondines/semana', { token: maria })).body;
        const turno = semana[2].id;
        const ok = await pedir('POST', `/api/v1/rondines/${turno}/asistencia`, { token: maria, body: { presente: true } });
        assert.equal(ok.status, 200);
        assert.equal(ok.body.mi_estado, 'confirmado');

        const antes = bandeja.length;
        const falta = await pedir('POST', `/api/v1/rondines/${turno}/asistencia`, { token: tomas, body: { presente: false } });
        assert.equal(falta.body.mi_estado, 'ausente');
        await esperarCorreo((c) => c.para === 'laura@vigia.test', antes);
        assert.ok(bandeja.slice(antes).some((c) => c.para === 'laura@vigia.test' && c.asunto.includes('Tomás Rodríguez')));

        assert.equal((await pedir('POST', `/api/v1/rondines/${turno}/asistencia`, { token: jorge, body: { presente: true } })).status, 404);
        assert.equal((await pedir('POST', `/api/v1/rondines/${turno}/asistencia`, { token: maria, body: { presente: 'si' } })).status, 400);
    });

    it('el comité crea un turno, lo reasigna conservando respuestas y lo borra', async () => {
        const crear = await pedir('POST', '/api/v1/rondines', { token: laura, body: { fecha: '2030-01-07', ruta: 'Circuito sur', vecino_ids: [1, 3] } });
        assert.equal(crear.status, 201, JSON.stringify(crear.body));
        assert.deepEqual(crear.body.pareja, ['María R.', 'Jorge L.']);
        const id = crear.body.id;
        assert.equal((await pedir('POST', '/api/v1/rondines', { token: laura, body: { fecha: '2030-01-07', ruta: 'x' } })).status, 409);
        assert.equal((await pedir('POST', '/api/v1/rondines', { token: laura, body: { fecha: '2030-01-08', ruta: 'x', vecino_ids: [999] } })).status, 400);

        await pedir('POST', `/api/v1/rondines/${id}/asistencia`, { token: maria, body: { presente: true } });
        const reasignar = await pedir('PUT', `/api/v1/rondines/${id}/asignaciones`, { token: laura, body: { vecino_ids: [1, 2] } });
        assert.equal(reasignar.status, 200);
        assert.deepEqual(reasignar.body.map((a: any) => [a.vecino_id, a.estado]), [[1, 'confirmado'], [2, 'pendiente']]);
        assert.equal((await pedir('GET', `/api/v1/rondines/${id}/asignaciones`, { token: maria })).status, 403);
        assert.equal((await pedir('DELETE', `/api/v1/rondines/${id}`, { token: laura })).status, 204);
        assert.equal((await pedir('GET', `/api/v1/rondines/${id}/asignaciones`, { token: laura })).status, 404);
    });
});

describe('alertas', () => {
    let alerta = 0;

    it('POST /alertas crea la alerta y avisa a todos los demás vecinos activos', async () => {
        const r = await pedir('POST', '/api/v1/alertas', { token: maria, body: { lat: null, lng: null } });
        assert.equal(r.status, 201);
        assert.deepEqual(r.body, { id: r.body.id, estado: 'activa' });
        alerta = r.body.id;

        const estado = await pedir('GET', `/api/v1/alertas/${alerta}`, { token: maria });
        assert.equal(estado.body.central_911_confirmada, false);
        assert.equal(estado.body.vecinos_avisados, 9);
        assert.equal(estado.body.en_camino, 0);
    });

    it('un segundo SOS del mismo vecino devuelve la alerta activa (200) sin duplicarla', async () => {
        const r = await pedir('POST', '/api/v1/alertas', { token: maria, body: { lat: -34.6, lng: -58.4 } });
        assert.equal(r.status, 200);
        assert.equal(r.body.id, alerta);
        assert.equal((await pedir('POST', '/api/v1/alertas', { token: maria, body: { lat: 200, lng: 0 } })).status, 400);
    });

    it('los vecinos ven la alerta activa y marcan "voy en camino"', async () => {
        const activas = await pedir('GET', '/api/v1/alertas', { token: jorge });
        assert.equal(activas.body[0].id, alerta);
        assert.equal(activas.body[0].mi_respuesta, 'notificado');
        assert.equal(activas.body[0].vecino.nombre, 'María Ríos');

        const r = await pedir('POST', `/api/v1/alertas/${alerta}/en-camino`, { token: jorge, body: { en_camino: true } });
        assert.equal(r.status, 200);
        assert.equal(r.body.en_camino, 1);
        assert.equal(r.body.mi_respuesta, 'en_camino');
        // Quien disparó la alerta no está entre los avisados.
        assert.equal((await pedir('POST', `/api/v1/alertas/${alerta}/en-camino`, { token: maria, body: { en_camino: true } })).status, 404);
    });

    it('el comité confirma el 911; un vecino común no puede', async () => {
        assert.equal((await pedir('POST', `/api/v1/alertas/${alerta}/confirmar-911`, { token: jorge })).status, 403);
        const r = await pedir('POST', `/api/v1/alertas/${alerta}/confirmar-911`, { token: laura });
        assert.equal(r.status, 200);
        assert.equal(r.body.central_911_confirmada, true);
    });

    it('solo quien la creó la cancela; después, cancelar otra vez → 409', async () => {
        assert.equal((await pedir('POST', `/api/v1/alertas/${alerta}/cancelar`, { token: jorge })).status, 404);
        const r = await pedir('POST', `/api/v1/alertas/${alerta}/cancelar`, { token: maria });
        assert.deepEqual(r.body, { id: alerta, estado: 'cancelada' });
        const otra = await pedir('POST', `/api/v1/alertas/${alerta}/cancelar`, { token: maria });
        assert.equal(otra.status, 409);
        assert.equal(otra.body.error.codigo, 'conflicto');
        assert.equal((await pedir('POST', `/api/v1/alertas/${alerta}/en-camino`, { token: jorge, body: { en_camino: false } })).status, 409);
        assert.equal((await pedir('GET', '/api/v1/alertas/99999', { token: maria })).status, 404);
    });

    it('resolver: el comité o quien la disparó', async () => {
        const { body } = await pedir('POST', '/api/v1/alertas', { token: tomas, body: {} });
        assert.equal((await pedir('POST', `/api/v1/alertas/${body.id}/resolver`, { token: jorge })).status, 403);
        const r = await pedir('POST', `/api/v1/alertas/${body.id}/resolver`, { token: laura });
        assert.deepEqual(r.body, { id: body.id, estado: 'resuelta' });
    });
});

describe('documentación', () => {
    it('cada ruta montada figura en docs/openapi.yaml (y viceversa)', async () => {
        const doc = parse(await readFile(new URL('../docs/openapi.yaml', import.meta.url), 'utf8'));
        const { rutasAuth } = await import('../src/routes/auth.ts');
        const otros = await Promise.all(
            ['alertas', 'barrio', 'publicaciones', 'rondines', 'vecinos'].map((m) => import(`../src/routes/${m}.ts`)),
        );
        const montadas = new Set<string>();
        const recorrer = (router: any, prefijo: string) => {
            for (const capa of router.stack) {
                if (!capa.route) continue;
                for (const metodo of Object.keys(capa.route.methods)) {
                    montadas.add(`${metodo} ${prefijo}${capa.route.path.replace(/:(\w+)/g, '{$1}')}`);
                }
            }
        };
        recorrer(rutasAuth, '/auth');
        for (const m of otros) recorrer(Object.values(m).find((v: any) => v?.stack), '');

        const documentadas = new Set<string>();
        for (const [ruta, metodos] of Object.entries<any>(doc.paths)) {
            for (const metodo of Object.keys(metodos)) {
                if (['get', 'post', 'put', 'patch', 'delete'].includes(metodo)) documentadas.add(`${metodo} ${ruta}`);
            }
        }
        documentadas.delete('get /health');
        documentadas.delete('get /health/ready');
        assert.deepEqual([...montadas].sort(), [...documentadas].sort());
    });
});
