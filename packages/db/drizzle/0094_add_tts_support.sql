CREATE TABLE `ttsProviderConfig` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text DEFAULT 'kokoro' NOT NULL,
	`baseUrl` text NOT NULL,
	`apiKey` text,
	`model` text DEFAULT 'kokoro' NOT NULL,
	`voice` text DEFAULT 'af_heart' NOT NULL
);
--> statement-breakpoint
ALTER TABLE `bookmarks` ADD `ttsStatus` text;