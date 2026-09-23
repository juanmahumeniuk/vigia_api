CREATE TABLE `alerta_respuestas` (
	`alerta_id` int unsigned NOT NULL,
	`vecino_id` int unsigned NOT NULL,
	`estado` enum('notificado','en_camino') NOT NULL DEFAULT 'notificado',
	`actualizado_en` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `alerta_respuestas_alerta_id_vecino_id_pk` PRIMARY KEY(`alerta_id`,`vecino_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint
CREATE TABLE `alertas` (
	`id` int unsigned AUTO_INCREMENT NOT NULL,
	`vecino_id` int unsigned NOT NULL,
	`lat` decimal(9,6),
	`lng` decimal(9,6),
	`estado` enum('activa','cancelada','resuelta') NOT NULL DEFAULT 'activa',
	`central_911_confirmada` boolean NOT NULL DEFAULT false,
	`creada_en` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`cerrada_en` datetime,
	CONSTRAINT `alertas_id` PRIMARY KEY(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint
CREATE TABLE `manzanas` (
	`id` int unsigned AUTO_INCREMENT NOT NULL,
	`nombre` varchar(50) NOT NULL,
	CONSTRAINT `manzanas_id` PRIMARY KEY(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint
CREATE TABLE `publicacion_respuestas` (
	`id` int unsigned AUTO_INCREMENT NOT NULL,
	`publicacion_id` int unsigned NOT NULL,
	`autor_id` int unsigned NOT NULL,
	`texto` varchar(500) NOT NULL,
	`creado_en` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `publicacion_respuestas_id` PRIMARY KEY(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint
CREATE TABLE `publicaciones` (
	`id` int unsigned AUTO_INCREMENT NOT NULL,
	`autor_id` int unsigned NOT NULL,
	`firma` varchar(40),
	`tipo` enum('actividad','noticia') NOT NULL,
	`etiqueta` enum('obras','seguridad','alumbrado','convivencia'),
	`titulo` varchar(140) NOT NULL,
	`cuerpo` text,
	`creado_en` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `publicaciones_id` PRIMARY KEY(`id`),
	CONSTRAINT `chk_publicaciones_etiqueta` CHECK((tipo = 'noticia') = (etiqueta IS NOT NULL))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint
CREATE TABLE `sesiones` (
	`token_hash` char(64) NOT NULL,
	`vecino_id` int unsigned NOT NULL,
	`creada_en` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`expira_en` datetime NOT NULL,
	CONSTRAINT `sesiones_token_hash` PRIMARY KEY(`token_hash`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint
CREATE TABLE `tokens_clave` (
	`token_hash` char(64) NOT NULL,
	`vecino_id` int unsigned NOT NULL,
	`tipo` enum('invitacion','recuperacion') NOT NULL,
	`expira_en` datetime NOT NULL,
	CONSTRAINT `tokens_clave_token_hash` PRIMARY KEY(`token_hash`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint
CREATE TABLE `turno_asignaciones` (
	`turno_id` int unsigned NOT NULL,
	`vecino_id` int unsigned NOT NULL,
	`estado` enum('pendiente','confirmado','ausente') NOT NULL DEFAULT 'pendiente',
	`respondido_en` datetime,
	CONSTRAINT `turno_asignaciones_turno_id_vecino_id_pk` PRIMARY KEY(`turno_id`,`vecino_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint
CREATE TABLE `turnos_rondin` (
	`id` int unsigned AUTO_INCREMENT NOT NULL,
	`fecha` date NOT NULL,
	`hora_inicio` time NOT NULL DEFAULT '22:00:00',
	`hora_fin` time NOT NULL DEFAULT '02:00:00',
	`ruta` varchar(200) NOT NULL,
	CONSTRAINT `turnos_rondin_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_turnos_fecha` UNIQUE(`fecha`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint
CREATE TABLE `vecinos` (
	`id` int unsigned AUTO_INCREMENT NOT NULL,
	`nombre` varchar(40) NOT NULL,
	`apellido` varchar(40) NOT NULL,
	`email` varchar(254) NOT NULL,
	`password_hash` varchar(255),
	`telefono` varchar(20),
	`manzana_id` int unsigned NOT NULL,
	`rol` enum('vecino','vigia','comite') NOT NULL DEFAULT 'vecino',
	`activo` boolean NOT NULL DEFAULT true,
	`ultimo_acceso` datetime,
	`creado_en` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `vecinos_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_vecinos_email` UNIQUE(`email`),
	CONSTRAINT `uq_vecinos_telefono` UNIQUE(`telefono`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint
ALTER TABLE `alerta_respuestas` ADD CONSTRAINT `fk_respuestas_alerta` FOREIGN KEY (`alerta_id`) REFERENCES `alertas`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `alerta_respuestas` ADD CONSTRAINT `fk_respuestas_vecino` FOREIGN KEY (`vecino_id`) REFERENCES `vecinos`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `alertas` ADD CONSTRAINT `fk_alertas_vecino` FOREIGN KEY (`vecino_id`) REFERENCES `vecinos`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `publicacion_respuestas` ADD CONSTRAINT `fk_pub_respuestas_publicacion` FOREIGN KEY (`publicacion_id`) REFERENCES `publicaciones`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `publicacion_respuestas` ADD CONSTRAINT `fk_pub_respuestas_autor` FOREIGN KEY (`autor_id`) REFERENCES `vecinos`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `publicaciones` ADD CONSTRAINT `fk_publicaciones_autor` FOREIGN KEY (`autor_id`) REFERENCES `vecinos`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `sesiones` ADD CONSTRAINT `fk_sesiones_vecino` FOREIGN KEY (`vecino_id`) REFERENCES `vecinos`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `tokens_clave` ADD CONSTRAINT `fk_tokens_vecino` FOREIGN KEY (`vecino_id`) REFERENCES `vecinos`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `turno_asignaciones` ADD CONSTRAINT `fk_asignaciones_turno` FOREIGN KEY (`turno_id`) REFERENCES `turnos_rondin`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `turno_asignaciones` ADD CONSTRAINT `fk_asignaciones_vecino` FOREIGN KEY (`vecino_id`) REFERENCES `vecinos`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `vecinos` ADD CONSTRAINT `fk_vecinos_manzana` FOREIGN KEY (`manzana_id`) REFERENCES `manzanas`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_respuestas_vecino` ON `alerta_respuestas` (`vecino_id`);--> statement-breakpoint
CREATE INDEX `idx_alertas_estado_fecha` ON `alertas` (`estado`,`creada_en`);--> statement-breakpoint
CREATE INDEX `idx_respuestas_publicacion` ON `publicacion_respuestas` (`publicacion_id`,`creado_en`);--> statement-breakpoint
CREATE INDEX `idx_publicaciones_tipo_fecha` ON `publicaciones` (`tipo`,`creado_en`);--> statement-breakpoint
CREATE INDEX `idx_sesiones_vecino` ON `sesiones` (`vecino_id`);--> statement-breakpoint
CREATE INDEX `idx_tokens_vecino` ON `tokens_clave` (`vecino_id`);--> statement-breakpoint
CREATE INDEX `idx_asignaciones_vecino` ON `turno_asignaciones` (`vecino_id`);--> statement-breakpoint
CREATE INDEX `idx_vecinos_acceso` ON `vecinos` (`activo`,`ultimo_acceso`);