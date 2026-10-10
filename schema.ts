// Intentionally empty by default.
// Add Drizzle tables here when the site actually needs a database.
// See examples/d1/db/schema.ts for an opt-in example.
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
export const pokerRooms=sqliteTable("poker_rooms",{code:text("code").primaryKey(),state:text("state").notNull(),revision:integer("revision").notNull().default(0),expiresAt:integer("expires_at").notNull()});
