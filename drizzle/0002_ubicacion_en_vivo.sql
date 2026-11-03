ALTER TABLE `alerta_respuestas` ADD `lat` decimal(9,6);--> statement-breakpoint
ALTER TABLE `alerta_respuestas` ADD `lng` decimal(9,6);--> statement-breakpoint
ALTER TABLE `alerta_respuestas` ADD `ubicacion_en` datetime;--> statement-breakpoint
ALTER TABLE `alertas` ADD `ubicacion_en` datetime;