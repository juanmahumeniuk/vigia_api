CREATE TABLE `dispositivos_push` (
	`token` varchar(255) NOT NULL,
	`vecino_id` int unsigned NOT NULL,
	`plataforma` enum('android','ios') NOT NULL DEFAULT 'android',
	`actualizado_en` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `dispositivos_push_token` PRIMARY KEY(`token`)
);
--> statement-breakpoint
ALTER TABLE `dispositivos_push` ADD CONSTRAINT `fk_dispositivos_vecino` FOREIGN KEY (`vecino_id`) REFERENCES `vecinos`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_dispositivos_vecino` ON `dispositivos_push` (`vecino_id`);