CREATE TABLE `fotos` (
	`id` int unsigned AUTO_INCREMENT NOT NULL,
	`vecino_id` int unsigned NOT NULL,
	`mime` varchar(20) NOT NULL,
	`datos` mediumblob NOT NULL,
	`creado_en` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `fotos_id` PRIMARY KEY(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint
CREATE TABLE `mensajes` (
	`id` int unsigned AUTO_INCREMENT NOT NULL,
	`autor_id` int unsigned NOT NULL,
	`texto` varchar(500),
	`foto_id` int unsigned,
	`creado_en` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `mensajes_id` PRIMARY KEY(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint
ALTER TABLE `alertas` ADD `foto_id` int unsigned;--> statement-breakpoint
ALTER TABLE `publicaciones` ADD `foto_id` int unsigned;--> statement-breakpoint
ALTER TABLE `fotos` ADD CONSTRAINT `fk_fotos_vecino` FOREIGN KEY (`vecino_id`) REFERENCES `vecinos`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `mensajes` ADD CONSTRAINT `fk_mensajes_autor` FOREIGN KEY (`autor_id`) REFERENCES `vecinos`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `mensajes` ADD CONSTRAINT `fk_mensajes_foto` FOREIGN KEY (`foto_id`) REFERENCES `fotos`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `alertas` ADD CONSTRAINT `fk_alertas_foto` FOREIGN KEY (`foto_id`) REFERENCES `fotos`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `publicaciones` ADD CONSTRAINT `fk_publicaciones_foto` FOREIGN KEY (`foto_id`) REFERENCES `fotos`(`id`) ON DELETE set null ON UPDATE no action;