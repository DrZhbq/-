CREATE TABLE `poker_rooms` (
	`code` text PRIMARY KEY NOT NULL,
	`state` text NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`expires_at` integer NOT NULL
);
