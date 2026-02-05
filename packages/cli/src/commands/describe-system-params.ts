/**
 * Use AI to generate short descriptions for required system parameters (env vars)
 * based on the code snippets where they are used.
 */

import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import type { RequiredSystemParam } from "@api-surface/types";
import type { SystemParamWithContext } from "@api-surface/core";

const SYSTEM_PROMPT = `You are a technical writer. Given a list of environment variable names (system parameters) and the code snippets where each is used, output a JSON array of objects with "name" and "description" keys.
- description: one short sentence explaining the purpose of the variable (e.g. "PostgreSQL connection string for the main database").
- Use the code context to infer purpose. Be concise.
Output only the JSON array, no markdown or code fence. Example: [{"name":"DATABASE_URL","description":"PostgreSQL connection string."}]`;

function buildUserPrompt(params: SystemParamWithContext[]): string {
  const lines = params.map(
    (p) =>
      `- ${p.name}${p.codeSnippet ? ` (used in: ${p.codeSnippet})` : ""}`,
  );
  return `Environment variables found in API route handlers:\n\n${lines.join("\n")}\n\nFor each variable, output one object with "name" and "description".`;
}

function stripJsonCodeFence(raw: string): string {
  let s = raw.trim();
  const openFence = /^```(?:json)?\s*\n?/i;
  const closeFence = /\n?```\s*$/;
  if (openFence.test(s)) {
    s = s.replace(openFence, "");
    if (closeFence.test(s)) s = s.replace(closeFence, "");
  }
  return s.trim();
}

export async function describeSystemParamsWithAi(
  params: SystemParamWithContext[],
  options: { anthropicKey?: string; openaiKey?: string },
): Promise<RequiredSystemParam[]> {
  if (params.length === 0) return [];
  const anthropicKey = options.anthropicKey?.trim();
  const openaiKey = options.openaiKey?.trim();
  if (!anthropicKey && !openaiKey) {
    return params.map((p) => ({ name: p.name }));
  }

  const userPrompt = buildUserPrompt(params);

  if (anthropicKey) {
    const anthropic = new Anthropic({ apiKey: anthropicKey });
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
      temperature: 0.2,
    });
    const textParts = (response.content ?? [])
      .filter(
        (block): block is { type: "text"; text: string } =>
          block.type === "text" && typeof (block as any).text === "string",
      )
      .map((b) => b.text);
    const rawContent = textParts.join("").trim();
    if (!rawContent) return params.map((p) => ({ name: p.name }));
    const content = stripJsonCodeFence(rawContent);
    try {
      const arr = JSON.parse(content) as Array<{
        name?: string;
        description?: string;
      }>;
      if (!Array.isArray(arr)) return params.map((p) => ({ name: p.name }));
      const byName = new Map(params.map((p) => [p.name, p.name]));
      return arr
        .filter((o) => o && typeof o.name === "string" && byName.has(o.name))
        .map((o) => ({
          name: o.name!,
          description:
            typeof o.description === "string" ? o.description.trim() : undefined,
        }));
    } catch {
      return params.map((p) => ({ name: p.name }));
    }
  }

  const openai = new OpenAI({ apiKey: openaiKey! });
  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
    temperature: 0.2,
  });
  const rawContent = response.choices[0]?.message?.content?.trim();
  if (!rawContent) return params.map((p) => ({ name: p.name }));
  let content = stripJsonCodeFence(rawContent);
  // Accept either JSON array or object with parameters/key
  if (content.startsWith("{")) {
    const obj = JSON.parse(content) as Record<string, unknown>;
    const arr = obj.parameters ?? obj.params ?? obj.descriptions ?? obj.results;
    if (Array.isArray(arr)) content = JSON.stringify(arr);
    else return params.map((p) => ({ name: p.name }));
  }
  try {
    const arr = JSON.parse(content) as Array<{
      name?: string;
      description?: string;
    }>;
    if (!Array.isArray(arr)) return params.map((p) => ({ name: p.name }));
    const byName = new Map(params.map((p) => [p.name, p.name]));
    return arr
      .filter((o) => o && typeof o.name === "string" && byName.has(o.name))
      .map((o) => ({
        name: o.name!,
        description:
          typeof o.description === "string" ? o.description.trim() : undefined,
      }));
  } catch {
    return params.map((p) => ({ name: p.name }));
  }
}
