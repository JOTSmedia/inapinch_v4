CREATE TABLE `bathroom_ratings` (
	`place_id` text NOT NULL,
	`visitor_id` text NOT NULL,
	`rating` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`place_id`, `visitor_id`),
	CONSTRAINT "bathroom_ratings_score_check" CHECK(typeof("bathroom_ratings"."rating") = 'integer' AND "bathroom_ratings"."rating" BETWEEN 1 AND 5)
);
--> statement-breakpoint
CREATE INDEX `bathroom_ratings_visitor_idx` ON `bathroom_ratings` (`visitor_id`);