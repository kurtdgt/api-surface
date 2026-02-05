/**
 * Use AI (Claude or OpenAI) to suggest a test payload and query params from an action JSON.
 * Uses ANTHROPIC_API_KEY or OPENAI_API_KEY from env.
 */

import Anthropic from "@anthropic-ai/sdk";
import { config as loadEnv } from "dotenv";
import OpenAI from "openai";

const SUGGEST_SYSTEM = `You are a test data generator. Given an action's payloadSchema, description, and httpMethod, output a single valid JSON object with exactly two keys:
- "payload": object for the request body (use realistic example values matching the schema types and descriptions)
- "queryParams": object for URL query parameters (use realistic example values; include any params that might be passed as query string)

Output only raw JSON, no markdown or code fence.`;

function stripJsonCodeFence(raw: string): string {
  let s = raw.trim();
  const fence = "```";
  if (s.startsWith(fence)) {
    s = s.slice(fence.length);
    if (s.startsWith("json")) s = s.slice(4).trim();
    const end = s.lastIndexOf(fence);
    if (end !== -1) s = s.slice(0, end).trim();
  }
  return s;
}

export interface SuggestTestPayloadResult {
  payload: Record<string, unknown>;
  queryParams: Record<string, string>;
}

export async function suggestTestPayload(
  actionJson: Record<string, unknown>
): Promise<SuggestTestPayloadResult> {
  loadEnv();
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!anthropicKey && !openaiKey) {
    throw new Error(
      "Set ANTHROPIC_API_KEY or OPENAI_API_KEY in .env for AI suggestions."
    );
  }

  const payloadSchema = actionJson.payloadSchema as
    | Record<string, unknown>
    | undefined;
  const description =
    typeof actionJson.description === "string" ? actionJson.description : "";
  const httpMethod =
    typeof actionJson.httpMethod === "string" ? actionJson.httpMethod : "POST";
  const displayName =
    typeof actionJson.displayName === "string" ? actionJson.displayName : "";

  const userPrompt = `Action: ${displayName || "unknown"}
Description: ${description}
HTTP method: ${httpMethod}

payloadSchema:
${JSON.stringify(payloadSchema ?? {}, null, 2)}

Generate a JSON object with "payload" and "queryParams" for testing this endpoint. Use realistic example values.`;

  if (anthropicKey) {
    const anthropic = new Anthropic({ apiKey: anthropicKey });
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 2048,
      system: SUGGEST_SYSTEM,
      messages: [{ role: "user", content: userPrompt }],
      temperature: 0.2,
    });
    type TextBlock = { type: "text"; text: string };
    const text = (response.content ?? [])
      .filter(
        (b): b is TextBlock =>
          b.type === "text" && typeof (b as TextBlock).text === "string"
      )
      .map((b) => (b as TextBlock).text)
      .join("")
      .trim();
    if (!text) throw new Error("Claude returned empty response");
    const parsed = JSON.parse(
      stripJsonCodeFence(text)
    ) as SuggestTestPayloadResult;
    return {
      payload:
        typeof parsed.payload === "object" && parsed.payload !== null
          ? (parsed.payload as Record<string, unknown>)
          : {},
      queryParams:
        typeof parsed.queryParams === "object" && parsed.queryParams !== null
          ? (parsed.queryParams as Record<string, string>)
          : {},
    };
  }

  const openai = new OpenAI({ apiKey: openaiKey! });
  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: SUGGEST_SYSTEM },
      { role: "user", content: userPrompt },
    ],
    temperature: 0.2,
  });
  const raw = completion.choices?.[0]?.message?.content?.trim();
  if (!raw) throw new Error("OpenAI returned empty response");
  const parsed = JSON.parse(
    stripJsonCodeFence(raw)
  ) as SuggestTestPayloadResult;
  return {
    payload:
      typeof parsed.payload === "object" && parsed.payload !== null
        ? (parsed.payload as Record<string, unknown>)
        : {},
    queryParams:
      typeof parsed.queryParams === "object" && parsed.queryParams !== null
        ? (parsed.queryParams as Record<string, string>)
        : {},
  };
}
