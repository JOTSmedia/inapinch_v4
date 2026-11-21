import { sql } from "drizzle-orm";
import { check, index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const bathroomRatings = sqliteTable("bathroom_ratings", {
  placeId: text("place_id").notNull(),
  visitorId: text("visitor_id").notNull(),
  rating: integer("rating").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [
  primaryKey({ columns: [table.placeId, table.visitorId] }),
  index("bathroom_ratings_visitor_idx").on(table.visitorId),
  check("bathroom_ratings_score_check", sql`typeof(${table.rating}) = 'integer' AND ${table.rating} BETWEEN 1 AND 5`),
]);
