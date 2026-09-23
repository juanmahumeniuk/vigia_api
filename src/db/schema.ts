// Esquema de la base (MySQL 8 / MariaDB 10.6+, InnoDB, utf8mb4_unicode_ci).
// Parte del DDL de la especificación §4.2; los cambios están en docs/BASE_DE_DATOS.md.
// Después de editar este archivo: `npm run db:generate` crea la migración SQL en drizzle/.
import { sql } from 'drizzle-orm';
import {
    boolean,
    char,
    check,
    date,
    datetime,
    decimal,
    foreignKey,
    index,
    int,
    mysqlEnum,
    mysqlTable,
    primaryKey,
    text,
    time,
    uniqueIndex,
    varchar,
} from 'drizzle-orm/mysql-core';

const ahora = sql`CURRENT_TIMESTAMP`;
const id = () => int('id', { unsigned: true }).autoincrement().primaryKey();
const fk = (columna: string) => int(columna, { unsigned: true }).notNull();

export const ROLES = ['vecino', 'vigia', 'comite'] as const;
export const ETIQUETAS = ['obras', 'seguridad', 'alumbrado', 'convivencia'] as const;
export const TIPOS_PUBLICACION = ['actividad', 'noticia'] as const;

export const manzanas = mysqlTable('manzanas', {
    id: id(),
    nombre: varchar('nombre', { length: 50 }).notNull(),
});

export const vecinos = mysqlTable(
    'vecinos',
    {
        id: id(),
        nombre: varchar('nombre', { length: 40 }).notNull(),
        apellido: varchar('apellido', { length: 40 }).notNull(),
        email: varchar('email', { length: 254 }).notNull(),
        // NULL = invitación pendiente: todavía no eligió contraseña.
        passwordHash: varchar('password_hash', { length: 255 }),
        telefono: varchar('telefono', { length: 20 }),
        manzanaId: fk('manzana_id'),
        rol: mysqlEnum('rol', ROLES).notNull().default('vecino'),
        activo: boolean('activo').notNull().default(true),
        ultimoAcceso: datetime('ultimo_acceso'),
        creadoEn: datetime('creado_en').notNull().default(ahora),
    },
    (t) => [
        uniqueIndex('uq_vecinos_email').on(t.email),
        uniqueIndex('uq_vecinos_telefono').on(t.telefono),
        index('idx_vecinos_acceso').on(t.activo, t.ultimoAcceso),
        foreignKey({ name: 'fk_vecinos_manzana', columns: [t.manzanaId], foreignColumns: [manzanas.id] }).onDelete('restrict'),
    ],
);

// Reemplaza a codigos_otp de la spec: enlace de un solo uso para elegir contraseña.
export const tokensClave = mysqlTable(
    'tokens_clave',
    {
        tokenHash: char('token_hash', { length: 64 }).primaryKey(), // SHA-256 del token del enlace
        vecinoId: fk('vecino_id'),
        tipo: mysqlEnum('tipo', ['invitacion', 'recuperacion']).notNull(),
        expiraEn: datetime('expira_en').notNull(),
    },
    (t) => [
        index('idx_tokens_vecino').on(t.vecinoId),
        foreignKey({ name: 'fk_tokens_vecino', columns: [t.vecinoId], foreignColumns: [vecinos.id] }).onDelete('cascade'),
    ],
);

export const sesiones = mysqlTable(
    'sesiones',
    {
        tokenHash: char('token_hash', { length: 64 }).primaryKey(), // SHA-256 del token Bearer
        vecinoId: fk('vecino_id'),
        creadaEn: datetime('creada_en').notNull().default(ahora),
        expiraEn: datetime('expira_en').notNull(),
    },
    (t) => [
        index('idx_sesiones_vecino').on(t.vecinoId),
        foreignKey({ name: 'fk_sesiones_vecino', columns: [t.vecinoId], foreignColumns: [vecinos.id] }).onDelete('cascade'),
    ],
);

export const publicaciones = mysqlTable(
    'publicaciones',
    {
        id: id(),
        autorId: fk('autor_id'),
        firma: varchar('firma', { length: 40 }), // "Comité", "Municipio"; NULL = nombre del autor
        tipo: mysqlEnum('tipo', TIPOS_PUBLICACION).notNull(),
        etiqueta: mysqlEnum('etiqueta', ETIQUETAS), // obligatoria en noticias, NULL en actividad
        titulo: varchar('titulo', { length: 140 }).notNull(),
        cuerpo: text('cuerpo'),
        creadoEn: datetime('creado_en').notNull().default(ahora),
    },
    (t) => [
        index('idx_publicaciones_tipo_fecha').on(t.tipo, t.creadoEn),
        // Noticia ⇔ tiene etiqueta (NewsItem.fromJson la lee como String no nulo).
        check('chk_publicaciones_etiqueta', sql`(tipo = 'noticia') = (etiqueta IS NOT NULL)`),
        foreignKey({ name: 'fk_publicaciones_autor', columns: [t.autorId], foreignColumns: [vecinos.id] }).onDelete('restrict'),
    ],
);

export const publicacionRespuestas = mysqlTable(
    'publicacion_respuestas',
    {
        id: id(),
        publicacionId: fk('publicacion_id'),
        autorId: fk('autor_id'),
        texto: varchar('texto', { length: 500 }).notNull(),
        creadoEn: datetime('creado_en').notNull().default(ahora),
    },
    (t) => [
        index('idx_respuestas_publicacion').on(t.publicacionId, t.creadoEn),
        foreignKey({ name: 'fk_pub_respuestas_publicacion', columns: [t.publicacionId], foreignColumns: [publicaciones.id] }).onDelete('cascade'),
        foreignKey({ name: 'fk_pub_respuestas_autor', columns: [t.autorId], foreignColumns: [vecinos.id] }).onDelete('restrict'),
    ],
);

export const turnosRondin = mysqlTable(
    'turnos_rondin',
    {
        id: id(),
        fecha: date('fecha', { mode: 'string' }).notNull(),
        horaInicio: time('hora_inicio').notNull().default('22:00:00'),
        horaFin: time('hora_fin').notNull().default('02:00:00'), // puede terminar al día siguiente
        ruta: varchar('ruta', { length: 200 }).notNull(),
    },
    (t) => [uniqueIndex('uq_turnos_fecha').on(t.fecha)],
);

export const turnoAsignaciones = mysqlTable(
    'turno_asignaciones',
    {
        turnoId: fk('turno_id'),
        vecinoId: fk('vecino_id'),
        estado: mysqlEnum('estado', ['pendiente', 'confirmado', 'ausente']).notNull().default('pendiente'),
        respondidoEn: datetime('respondido_en'),
    },
    (t) => [
        primaryKey({ columns: [t.turnoId, t.vecinoId] }),
        index('idx_asignaciones_vecino').on(t.vecinoId),
        foreignKey({ name: 'fk_asignaciones_turno', columns: [t.turnoId], foreignColumns: [turnosRondin.id] }).onDelete('cascade'),
        foreignKey({ name: 'fk_asignaciones_vecino', columns: [t.vecinoId], foreignColumns: [vecinos.id] }).onDelete('cascade'),
    ],
);

export const alertas = mysqlTable(
    'alertas',
    {
        id: id(),
        vecinoId: fk('vecino_id'),
        lat: decimal('lat', { precision: 9, scale: 6, mode: 'number' }), // NULL hasta tener GPS
        lng: decimal('lng', { precision: 9, scale: 6, mode: 'number' }),
        estado: mysqlEnum('estado', ['activa', 'cancelada', 'resuelta']).notNull().default('activa'),
        central911Confirmada: boolean('central_911_confirmada').notNull().default(false),
        creadaEn: datetime('creada_en').notNull().default(ahora),
        cerradaEn: datetime('cerrada_en'),
    },
    (t) => [
        index('idx_alertas_estado_fecha').on(t.estado, t.creadaEn),
        foreignKey({ name: 'fk_alertas_vecino', columns: [t.vecinoId], foreignColumns: [vecinos.id] }).onDelete('restrict'),
    ],
);

export const alertaRespuestas = mysqlTable(
    'alerta_respuestas',
    {
        alertaId: fk('alerta_id'),
        vecinoId: fk('vecino_id'),
        estado: mysqlEnum('estado', ['notificado', 'en_camino']).notNull().default('notificado'),
        actualizadoEn: datetime('actualizado_en').notNull().default(ahora),
    },
    (t) => [
        primaryKey({ columns: [t.alertaId, t.vecinoId] }),
        index('idx_respuestas_vecino').on(t.vecinoId),
        foreignKey({ name: 'fk_respuestas_alerta', columns: [t.alertaId], foreignColumns: [alertas.id] }).onDelete('cascade'),
        foreignKey({ name: 'fk_respuestas_vecino', columns: [t.vecinoId], foreignColumns: [vecinos.id] }).onDelete('cascade'),
    ],
);
