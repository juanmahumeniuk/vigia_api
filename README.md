# VigiaApp API

API REST y base de datos de **VigiaApp**, la red de alerta vecinal. La app Flutter vive en otro repo
(`VigiaApp`); este proyecto es **solo la API y la base de datos**.

- **Stack:** Node 22/24 LTS · Express 5 · TypeScript · Drizzle ORM · MySQL 8 / MariaDB (Hostinger)
- **Contrato:** [`docs/openapi.yaml`](docs/openapi.yaml) (OpenAPI 3.1, la fuente de verdad)
- **Base de datos:** [`docs/BASE_DE_DATOS.md`](docs/BASE_DE_DATOS.md)
- **Qué cambia en la app respecto de la spec v1.0:** [`docs/CAMBIOS_CLIENTE.md`](docs/CAMBIOS_CLIENTE.md)

## Estructura

```
src/
  index.ts          arranque y cierre ordenado
  app.ts            middlewares, rutas en /api/v1, /health, 404 y errores
  config.ts         variables de entorno (valida al arrancar)
  auth.ts           requireAuth / requireComite, sesiones de 24 h, enlaces de invitación
  errors.ts         formato {error:{codigo,mensaje}}
  validar.ts        validación de entradas
  password.ts       scrypt
  mail.ts           SMTP (sin SMTP_HOST: consola)
  migrate.ts        aplica drizzle/
  db/schema.ts      esquema (Drizzle)
  db/index.ts       pool mysql2 en UTC
  routes/           auth, vecinos (+ /yo, /manzanas), barrio, publicaciones, rondines, alertas
drizzle/            migraciones SQL versionadas
scripts/seed.ts     datos de desarrollo
scripts/invitar.ts  alta del primer miembro del comité
test/api.test.ts    integración contra una base real
```

## Desarrollo local

Requiere Node ≥ 22.18. En desarrollo y en los tests, Node corre los `.ts` directamente, sin build.

```bash
npm install
cp .env.example .env

# MariaDB 11.8 (el motor de Hostinger) en un contenedor, puerto 3307:
podman run -d --name vigia-mariadb -p 127.0.0.1:3307:3306 \
  -e MARIADB_ROOT_PASSWORD=vigia -e MARIADB_DATABASE=vigia_dev \
  -e MARIADB_USER=vigia -e MARIADB_PASSWORD=vigia docker.io/library/mariadb:11.8

npm run db:migrate   # crea las tablas
npm run db:seed      # datos de ejemplo (BORRA lo que haya)
npm run dev          # http://localhost:3000/api/v1, recarga al guardar
```

Usuarios del seed (contraseña `vigia1234`):
- `maria@vigia.test`: vigía, con turno hoy.
- `laura@vigia.test`: comité.
- `jorge@vigia.test`, `ana@vigia.test` y otros.
- `sofia@vigia.test`: invitación pendiente, sin contraseña.

Sin `SMTP_HOST`, los correos (invitaciones, recuperación, avisos al comité) se imprimen en la consola con el enlace.

```bash
TOKEN=$(curl -s localhost:3000/api/v1/auth/login -H 'content-type: application/json' \
  -d '{"email":"maria@vigia.test","password":"vigia1234"}' | jq -r .token)
curl -s localhost:3000/api/v1/rondines/semana -H "Authorization: Bearer $TOKEN" | jq
```

### Scripts

| Script | Qué hace |
|---|---|
| `npm run dev` | API con recarga (`node --watch`) |
| `npm test` | Tests de integración contra `TEST_DATABASE_URL`. **Borra y recrea esa base** |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run build` | Compila a `dist/` **y migra** la base de `DATABASE_URL` (lo que corre Hostinger) |
| `npm run compile` | Solo compila a `dist/` |
| `npm start` | Corre `dist/` (producción) |
| `npm run db:generate` | Genera la migración SQL después de cambiar `src/db/schema.ts` |
| `npm run db:migrate` | Aplica las migraciones pendientes (desde `src/`) |
| `npm run db:migrate:prod` | Lo mismo, desde `dist/` (lo usa el build de Hostinger) |
| `npm run db:seed` | Datos de ejemplo. No corre con `NODE_ENV=production` |
| `npm run invitar -- <email> <nombre> <apellido>` | Crea o promueve un vecino al comité y le envía la invitación |

### Cambiar el esquema

1. Editar `src/db/schema.ts`.
2. Correr `npm run db:generate` y revisar el SQL nuevo en `drizzle/`. Si crea tablas, agregarles `ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`.
3. Correr `npm run db:migrate` y después `npm test`.
4. Commitear el esquema y la migración juntos. En Hostinger la migración se aplica en el build.

## Deploy en Hostinger

Requiere el plan **Business** o **Cloud**, que incluyen *Node.js Web Apps*. Es el mismo esquema que la API de SentidoBiologico.

1. **Base de datos.** hPanel → Bases de datos → MySQL: crear la base y el usuario.
2. **Repositorio.** Subir este repo a GitHub.
3. **Node.js Web App.** hPanel → Websites → Add website → Node.js Web App → GitHub (rama `main`):
   - Node: **24.x** (o 22.x si no aparece la 24)
   - Preset: **Express** · Gestor: **npm** · Archivo de entrada: `dist/src/index.js`
   - Install: `npm run hostinger:install` (`npm ci`). TypeScript y los `@types` están en `dependencies` a propósito: Hostinger instala sin devDependencies y el build los necesita
   - Build: `npm run build` (= `hostinger:build`: compila **y aplica las migraciones pendientes**, igual que la API de SentidoBiologico). Por eso `DATABASE_URL` tiene que estar cargada **antes** del primer deploy
   - Start: `npm start`
4. **Variables de entorno** (en hPanel, nunca en el repo):

   | Variable | Valor |
   |---|---|
   | `NODE_ENV` | `production` |
   | `DATABASE_URL` | `mysql://uXXXX_vigia:<pass>@127.0.0.1:3306/uXXXX_vigia` (siempre `127.0.0.1`, no `localhost` ni `srvNNNN.hstgr.io`). Si la contraseña tiene `@ : / # ?`, va codificada en URL |
   | `TRUST_PROXY` | `1` |
   | `APP_URL_CLAVE` | Base del enlace de los correos, p. ej. `vigiaapp://clave` (ver `docs/CAMBIOS_CLIENTE.md` §3) |
   | `BARRIO_TZ` | `America/Argentina/Buenos_Aires` |
   | `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | Casilla de envío. Con el correo de Hostinger: `smtp.hostinger.com`, `465`, `true`. En producción son obligatorias |

   Opcionales: `DB_POOL_LIMIT` (5; el hosting compartido limita las conexiones por usuario) y `AUTH_RATE_LIMIT_MAX` (20). **No** cargar `PORT` (lo asigna Hostinger) ni `TEST_DATABASE_URL` (los tests borran esa base).
5. **HTTPS.** Activar el SSL y "Forzar HTTPS" en el dominio de la app (RNF-02).
6. **Primer comité.** Por SSH, en la carpeta de la app: `node dist/scripts/invitar.js presidente@mail.com Nombre Apellido`. Desde ahí, el comité da de alta al resto desde la app.
7. **Verificar.** `https://<dominio>/health/ready` → `{"status":"ok","db":"up"}`.

## Decisiones

- **Formato de error único** `{error:{codigo,mensaje}}`, como en la spec §3.1. Los `mensaje` están en castellano para mostrarlos tal cual.
- **Sesión.** Token aleatorio de 32 bytes; en la base solo se guarda su SHA-256. Vence a las 24 h. Recuperar o cambiar la clave, o desactivar al vecino, cierra sus sesiones.
- **Contraseñas** con `scrypt` de Node: no bloquea el event loop y no necesita módulos nativos. Al hacer login con un email que no existe también se hace el cálculo, así el tiempo de respuesta no revela qué emails están registrados.
- **"En línea"** (RNF-08): `ultimo_acceso` se actualiza como mucho una vez por minuto, no en cada polling de 2 s.
- **Rate limit** en memoria, solo en `/auth/*`. Alcanza con un proceso Node. Con varias instancias habría que pasar a un store compartido.
- **Sin CORS.** La app móvil no lo necesita. Si aparece un cliente web, agregar el paquete `cors` con el origen exacto.
- **Fuera de alcance:** push (FCM), integración automática con el 911, edición de publicaciones.
