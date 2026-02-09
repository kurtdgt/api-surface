/**
 * Use AI to generate PostgreSQL/Supabase SQL from a Prisma schema.
 * Reads prisma/schema.prisma and outputs SQL suitable for Supabase SQL Editor.
 * Uses ANTHROPIC_API_KEY or OPENAI_API_KEY from env.
 */

import Anthropic from "@anthropic-ai/sdk";
import { config as loadEnv } from "dotenv";
import OpenAI from "openai";

const SYSTEM_PROMPT = `You are a database expert. Given a Prisma schema, output a single PostgreSQL SQL script that can be run in Supabase SQL Editor to create the same schema.

Rules:
- Output only valid PostgreSQL (Supabase-compatible) SQL. No markdown, no code fence, no explanation before or after.
- Map Prisma types to PostgreSQL types (e.g. String -> TEXT/VARCHAR, Int -> INTEGER, Boolean -> BOOLEAN, DateTime -> TIMESTAMPTZ, Json -> JSONB, Decimal -> DECIMAL/NUMERIC).
- Create ENUMs for Prisma enums.
- Create tables with appropriate columns, primary keys, and unique constraints.
- Add indexes for @@index and @@unique. Use CREATE INDEX ... ON ... for @@index.
- Use IF NOT EXISTS for CREATE TABLE and CREATE TYPE where it makes sense to allow re-running the script safely.
- Use snake_case for table/column names if the Prisma schema uses @@map/@@id; otherwise derive from the Prisma model/field names (Prisma defaults to camelCase in schema but often maps to snake_case in DB).
- Include any @@map("table_name") and @map("column_name") as the actual table/column names in SQL.
- Do not include Prisma migrations metadata or unrelated comments.`;

function stripSqlCodeFence(raw: string): string {
  let s = raw.trim();
  const fence = "```";
  if (s.startsWith(fence)) {
    s = s.slice(fence.length);
    if (s.toLowerCase().startsWith("sql")) s = s.slice(3).trim();
    const end = s.lastIndexOf(fence);
    if (end !== -1) s = s.slice(0, end).trim();
  }
  return s;
}

export interface GeneratePrismaSqlResult {
  sql: string;
}

export async function generatePrismaSqlFromSchema(
  schemaContent: string,
  options: { anthropicKey?: string; openaiKey?: string }
): Promise<GeneratePrismaSqlResult> {
  const anthropicKey = options.anthropicKey?.trim();
  const openaiKey = options.openaiKey?.trim();
  if (!anthropicKey && !openaiKey) {
    throw new Error(
      "Set ANTHROPIC_API_KEY or OPENAI_API_KEY in .env for Prisma → SQL generation."
    );
  }

  const userPrompt = `Convert this Prisma schema to PostgreSQL SQL for Supabase:\n\n${schemaContent}`;

  if (anthropicKey) {
    const anthropic = new Anthropic({ apiKey: anthropicKey });
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 8192,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
      temperature: 0.2,
    });
    type TextBlock = { type: "text"; text: string };
    const text =
      (response.content ?? [])
        .filter(
          (b): b is TextBlock =>
            b.type === "text" && typeof (b as TextBlock).text === "string"
        )
        .map((b) => (b as TextBlock).text)
        .join("")
        .trim() || "";
    if (!text) throw new Error("AI returned empty response");
    return { sql: stripSqlCodeFence(text) };
  }

  const openai = new OpenAI({ apiKey: openaiKey! });
  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
    temperature: 0.2,
  });
  const raw = completion.choices?.[0]?.message?.content?.trim();
  if (!raw) throw new Error("OpenAI returned empty response");
  return { sql: stripSqlCodeFence(raw) };
}
