import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, real, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const answerKeys = pgTable("answer_keys", {
  id: varchar("id").primaryKey(),
  userId: varchar("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  subject: text("subject").notNull(),
  totalQuestions: integer("total_questions").notNull(),
  optionsPerQuestion: integer("options_per_question").notNull(),
  answersEncrypted: text("answers_encrypted").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const scanResults = pgTable("scan_results", {
  id: varchar("id").primaryKey(),
  userId: varchar("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  answerKeyId: varchar("answer_key_id").notNull(),
  answerKeyName: text("answer_key_name").notNull(),
  subject: text("subject").notNull(),
  dataEncrypted: text("data_encrypted").notNull(),
  score: real("score").notNull(),
  totalQuestions: integer("total_questions").notNull(),
  percentage: real("percentage").notNull(),
  scannedAt: timestamp("scanned_at").defaultNow().notNull(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
