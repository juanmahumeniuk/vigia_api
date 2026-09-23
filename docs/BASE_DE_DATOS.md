# VigiaApp · Base de datos

MySQL 8 o MariaDB 10.6+ (Hostinger usa MariaDB), motor InnoDB, `utf8mb4_unicode_ci`, todo en **UTC**.

- **Fuente de verdad del esquema:** `src/db/schema.ts` (Drizzle).
- **Migraciones:** `drizzle/NNNN_*.sql`, generadas con `npm run db:generate` y aplicadas con `npm run db:migrate`. La tabla `__drizzle_migrations` registra cuáles ya corrieron.
- **Zona horaria:** cada conexión ejecuta `SET time_zone = '+00:00'`, así `DEFAULT CURRENT_TIMESTAMP` y `UTC_TIMESTAMP()` coinciden (`src/db/index.ts`).

## Diagrama entidad-relación

```
manzanas 1───* vecinos 1───* sesiones
                  │  1───* tokens_clave
                  │  1───* publicaciones 1───* publicacion_respuestas *───1 vecinos
                  │  1───* alertas 1───* alerta_respuestas *───1 vecinos
                  │
                  └──* turno_asignaciones *───1 turnos_rondin
```

| Tabla | Propósito | Endpoints |
|---|---|---|
| `manzanas` | Manzanas del barrio | `/manzanas`, alta de vecinos |
| `vecinos` | Vecinos de la red: rol, email, hash de contraseña, último acceso | todos |
| `tokens_clave` | Enlaces de un solo uso para elegir contraseña (invitación / recuperación) | `/auth/clave`, `/auth/recuperar`, `/vecinos` |
| `sesiones` | Tokens Bearer de 24 h (solo el SHA-256) | todas las rutas autenticadas |
| `publicaciones` | Feed de actividad y noticias del comité | `/publicaciones` |
| `publicacion_respuestas` | Respuestas a una publicación | `/publicaciones/{id}/respuestas` |
| `turnos_rondin` | Un turno por fecha (por defecto 22:00–02:00) | `/rondines/*` |
| `turno_asignaciones` | Quién hace cada turno y qué respondió | `/rondines/*` |
| `alertas` | Cada SOS disparado | `/alertas/*` |
| `alerta_respuestas` | Una fila por vecino avisado: `notificado` o `en_camino` | `/alertas/*` |

## Cambios respecto de la especificación v1.0 (§4.2)

| Tabla | Cambio | Motivo |
|---|---|---|
| `vecinos` | Se agregan `email VARCHAR(254) NOT NULL UNIQUE` y `password_hash VARCHAR(255) NULL` | El login es por email y contraseña. `password_hash` en NULL indica que la invitación sigue pendiente |
| `vecinos` | `telefono` pasa a ser NULL (sigue siendo UNIQUE) | Ya no es la credencial, es un dato de contacto |
| `codigos_otp` | **Se reemplaza** por `tokens_clave (token_hash PK, vecino_id, tipo, expira_en)` | No hay SMS. El enlace dura 7 días si es una invitación y 1 hora si es una recuperación. Emitir uno nuevo invalida los anteriores; usarlo los borra todos |
| `publicaciones` | Se quita la columna `respuestas` | Ahora se calcula con `COUNT` sobre `publicacion_respuestas`: un contador desnormalizado puede desfasarse. El JSON de salida no cambia |
| `publicaciones` | `CHECK ((tipo = 'noticia') = (etiqueta IS NOT NULL))` | Una noticia siempre lleva etiqueta y una actividad nunca (`NewsItem.fromJson` la lee como `String` no nulo) |
| `publicacion_respuestas` | Tabla nueva | Las respuestas que cuenta el feed |
| `alertas`, `alerta_respuestas` | Sin cambios de estructura | Ahora tienen endpoints para `en_camino`, `central_911_confirmada` y `resuelta` |

Las demás tablas, índices y claves foráneas son los de la especificación.

## Reglas que garantiza la base

- Email y teléfono únicos (`uq_vecinos_email`, `uq_vecinos_telefono`).
- Un turno por fecha (`uq_turnos_fecha`).
- Un vecino no puede estar asignado dos veces al mismo turno ni avisado dos veces de la misma alerta (PK compuestas).
- Borrar un vecino está restringido si publicó o disparó alertas (`ON DELETE RESTRICT`). Para darlo de baja se usa `activo = 0` (`PATCH /vecinos/{id}`).
- Borrar un turno, una publicación o una alerta borra en cascada sus asignaciones, respuestas o avisos.

## Reglas que garantiza la API

- `POST /alertas` crea la alerta y las filas de `alerta_respuestas` en una sola transacción, bloqueando la fila del vecino con `SELECT … FOR UPDATE`. Así dos toques seguidos del SOS no crean dos alertas activas.
- Canjear un enlace de `tokens_clave` bloquea la fila con `FOR UPDATE`, así un mismo enlace no se usa dos veces aunque lleguen dos pedidos a la vez.
- Los cambios de estado de una alerta (`cancelar`, `resolver`) usan `UPDATE … WHERE estado = 'activa'`. Si no afecta ninguna fila, responden 409.

## Operación

- **Crear la base en Hostinger:** hPanel → Bases de datos → MySQL. El build aplica las migraciones solo (ver README).
- **Cambiar el esquema:** editar `src/db/schema.ts`, correr `npm run db:generate`, revisar el SQL generado y commitearlo. La migración se aplica en el próximo deploy. Nunca editar una migración ya aplicada en producción.
- **Charset:** las migraciones fijan `ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci` en cada `CREATE TABLE`. Si `drizzle-kit generate` crea tablas nuevas, agregar ese sufijo a mano en el SQL generado.
- **Limpieza:** las sesiones vencidas de un vecino se borran cada vez que inicia sesión. Los enlaces vencidos se reemplazan cuando se emite uno nuevo.
