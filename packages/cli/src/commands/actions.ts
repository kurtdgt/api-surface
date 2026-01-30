/**
 * Actions command - generate action JSON files from API function JSON using Claude or OpenAI.
 * Converts API function payloads (method, url, functionCode) to the action template format.
 * Uses ANTHROPIC_API_KEY for Claude, or OPENAI_API_KEY for OpenAI.
 */

import Anthropic from "@anthropic-ai/sdk";
import { config as loadEnv } from "dotenv";
import * as fs from "fs/promises";
import OpenAI from "openai";
import * as path from "path";

/** API function payload (one per endpoint, from function code output). */
export interface ApiFunctionPayload {
  method: string;
  url: string;
  functionName?: string;
  functionFile?: string;
  functionCode?: string | null;
  functionResolutionConfidence?: string;
}

/** Action JSON structure (matches templates/action.template.json). */
export interface ActionJson {
  serviceKey: string;
  actionName: string;
  displayName: string;
  description: string;
  language: "javascript";
  functionCode: string;
  httpMethod: string;
  systemParameters: string[];
  payloadSchema: {
    type: "object";
    properties: Record<string, { type?: string; description?: string }>;
    required: string[];
  };
  responseSchema: {
    type: "object";
    properties: Record<string, { type?: string }>;
  };
}

export interface ActionsOptions {
  inputDir: string;
  outputDir: string;
  serviceKey?: string;
  /** App name to concatenate with action name (e.g. resto-inspect → get-resto-inspect-properties) */
  appName?: string;
  /** Path to .env file */
  envPath?: string;
  /** Path to action.config.json (default: action.config.json in cwd) */
  configPath?: string;
}

const ACTION_TEMPLATE = `You are a converter. Given an API route handler (HTTP method, URL path, and source code), output a single valid JSON object that matches this exact structure. No markdown, no code fence, only raw JSON.

Required JSON shape:
{
  "serviceKey": "<string, required>",
  "actionName": "<kebab-case identifier derived from method and URL path, e.g. post-api-auth-refresh>",
  "displayName": "<human-readable title, e.g. Refresh Auth Token>",
  "description": "<one or two sentences describing what the endpoint does>",
  "language": "javascript",
  "functionCode": "<MUST be a single async function: async function executeAction(payload, context) { ... }; escape newlines as \\n>",
  "httpMethod": "<GET|POST|PUT|PATCH|DELETE>",
  "systemParameters": ["<env var names; use PLAYGROUND_DATABASE_URL or the name from process.env when the handler uses a database>"],
  "payloadSchema": {
    "type": "object",
    "properties": { "<paramName>": { "type": "string", "description": "..." } },
    "required": ["<required param names>"]
  },
  "responseSchema": {
    "type": "object",
    "properties": { "success": { "type": "boolean" }, "data": { "type": "object" }, "error": { "type": "string" } }
  }
}

CRITICAL - functionCode conversion (Next.js handler → executeAction):
- functionCode MUST be exactly: async function executeAction(payload, context) { ... }
- Do NOT copy the raw Next.js handler (no "export async function GET/POST", no "NextRequest", no "NextResponse").
- Convert the handler logic as follows:
  1. Request body (await request.json()) → use "payload" directly (payload is the parsed body / combined params).
  2. Query params and route params → put them in payloadSchema and pass as "payload" (e.g. payload.id, payload.userId).
  3. process.env.X (e.g. DATABASE_URL) → context.systemParams.X (e.g. context.systemParams.PLAYGROUND_DATABASE_URL). Add that name to systemParameters.
  4. console.log / console.error → context.logger.info / context.logger.error (if needed).
  5. NextResponse.json({ ... }) → return { success: true, data: ... } or return { success: false, error: "..." }.
  6. Validation errors (400) → return { success: false, error: "message" }.
  7. Keep the core business logic (DB calls, validation, etc.) inside executeAction; only the signature and I/O must follow the pattern above.
  8. Do NOT use Prisma or @prisma/client in functionCode. If the original handler uses prisma (e.g. prisma.inspection.findMany), rewrite the logic using raw SQL and a database client (e.g. const { Pool } = require("pg"); const pool = new Pool({ connectionString: context.systemParams.PLAYGROUND_DATABASE_URL }); pool.query("SELECT ...")). Translate Prisma queries into equivalent SQL; use context.systemParams for the connection string.
- actionName must be kebab-case, e.g. get-api-users or post-api-auth-login.
- Infer payloadSchema from the handler (request body, query, params).
- responseSchema must include success, data, error as in the shape above.
- Output only the JSON object, no other text.`;

function buildUserPrompt(
  payload: ApiFunctionPayload,
  serviceKey: string,
  defaultDatabaseUrl?: string,
): string {
  const parts = [
    `Convert this Next.js API route handler into the action JSON format.`,
    ``,
    `The functionCode in your output MUST be an executeAction function, NOT the raw handler:`,
    `  async function executeAction(payload, context) { ... }`,
    ``,
    `Map: request body/params → payload; process.env → context.systemParams; NextResponse.json → return { success, data } or { success: false, error }.`,
    ``,
    `Do NOT use Prisma or @prisma/client in the generated functionCode. Use raw SQL with pg (node-postgres) and context.systemParams for the database URL instead.`,
    ``,
    `method: ${payload.method}`,
    `url: ${payload.url}`,
    `Original handler code:`,
    `\`\`\``,
    payload.functionCode ?? "",
    `\`\`\``,
    ``,
    `Use serviceKey: "${serviceKey}".`,
  ];
  if (defaultDatabaseUrl) {
    parts.push(
      `Use "${defaultDatabaseUrl}" in systemParameters and use context.systemParams.${defaultDatabaseUrl} inside executeAction for database connection.`,
    );
  }
  parts.push(
    `Output only the JSON object. functionCode must be executeAction(payload, context).`,
  );
  return parts.join("\n");
}

function slugifyActionName(method: string, url: string): string {
  const pathPart = url
    .replace(/^https?:\/\//i, "")
    .replace(/\?.*$/, "")
    .replace(/[^a-zA-Z0-9/-]/g, "_")
    .replace(/\/+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 80);
  return `${method.toLowerCase()}_${pathPart}`.replace(/_+/g, "_");
}

/**
 * Insert app name into action name after the method.
 * When app name is set, a leading "api-" in the path is dropped so the result is like get-resto-inspect-properties.
 * Example: get-api-properties + resto-inspect → get-resto-inspect-properties.
 * Example: post-api-auth-refresh + resto-inspect → post-resto-inspect-auth-refresh.
 */
function applyAppNameToActionName(actionName: string, appName: string): string {
  const normalized = actionName.trim().toLowerCase().replace(/\s+/g, "-");
  const parts = normalized.split("-").filter(Boolean);
  if (parts.length === 0) return appName;
  const method = parts[0];
  let rest = parts.slice(1).join("-");
  if (rest.startsWith("api-")) rest = rest.slice(4);
  return rest ? `${method}-${appName}-${rest}` : `${method}-${appName}`;
}

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

async function readApiFunctionFiles(
  inputDir: string,
): Promise<ApiFunctionPayload[]> {
  const resolved = path.resolve(inputDir);
  const entries = await fs.readdir(resolved, { withFileTypes: true });
  const payloads: ApiFunctionPayload[] = [];
  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith(".json")) continue;
    const filePath = path.join(resolved, e.name);
    const raw = await fs.readFile(filePath, "utf-8");
    try {
      const data = JSON.parse(raw) as ApiFunctionPayload;
      if (
        data &&
        typeof data.method === "string" &&
        typeof data.url === "string"
      ) {
        payloads.push(data);
      } else {
        console.warn(
          `  ⚠ Skipped ${e.name}: missing or invalid "method" or "url"`,
        );
      }
    } catch (parseError) {
      const msg =
        parseError instanceof Error ? parseError.message : String(parseError);
      console.warn(`  ⚠ Invalid JSON in ${e.name}: ${msg}`);
    }
  }
  return payloads;
}

/** Sleep for ms milliseconds (for pacing and backoff). */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Strip markdown code fence (```json ... ``` or ``` ... ```) from AI response
 * so we can parse raw JSON even when the model wraps it in a code block.
 */
function stripJsonCodeFence(raw: string): string {
  let s = raw.trim();
  const openFence = /^```(?:json)?\s*\n?/i;
  const closeFence = /\n?```\s*$/;
  if (openFence.test(s)) {
    s = s.replace(openFence, "");
    if (closeFence.test(s)) {
      s = s.replace(closeFence, "");
    }
  }
  return s.trim();
}

/** Default delay between API requests to avoid rate limits (ms). */
const DEFAULT_DELAY_BETWEEN_REQUESTS_MS = 500;
/** Max retries on 429/503. */
const MAX_RETRIES = 5;
/** Initial backoff ms; doubles each retry. */
const INITIAL_BACKOFF_MS = 2000;

/**
 * Call OpenAI with retry on rate limit (429) and server errors (503).
 * Uses exponential backoff and respects Retry-After when present.
 */
async function convertWithOpenAI(
  payload: ApiFunctionPayload,
  serviceKey: string,
  apiKey: string,
  defaultDatabaseUrl?: string,
): Promise<ActionJson> {
  const openai = new OpenAI({ apiKey });
  const userPrompt = buildUserPrompt(payload, serviceKey, defaultDatabaseUrl);
  let lastError: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: ACTION_TEMPLATE },
          { role: "user", content: userPrompt },
        ],
        response_format: { type: "json_object" },
        temperature: 0.2,
      });
      const rawContent = response.choices[0]?.message?.content?.trim();
      if (!rawContent) {
        throw new Error("OpenAI returned empty response");
      }
      const content = stripJsonCodeFence(rawContent);
      const parsed = JSON.parse(content) as ActionJson;
      if (!parsed.actionName || !parsed.httpMethod) {
        parsed.actionName =
          parsed.actionName || slugifyActionName(payload.method, payload.url);
        parsed.httpMethod = parsed.httpMethod || payload.method;
      }
      if (!parsed.functionCode && payload.functionCode) {
        parsed.functionCode = payload.functionCode;
      }
      if (!parsed.payloadSchema) {
        parsed.payloadSchema = { type: "object", properties: {}, required: [] };
      }
      if (!parsed.responseSchema) {
        parsed.responseSchema = { type: "object", properties: {} };
      }
      if (!Array.isArray(parsed.systemParameters)) {
        parsed.systemParameters = [];
      }
      parsed.language = "javascript";
      return parsed;
    } catch (err: unknown) {
      lastError = err;
      const status = (err as { status?: number })?.status;
      const isRateLimit = status === 429;
      const isServerError = status === 503;
      const headers = (err as { headers?: Record<string, string> })?.headers;
      const retryAfter = headers?.["retry-after"];
      if ((isRateLimit || isServerError) && attempt < MAX_RETRIES) {
        let waitMs = INITIAL_BACKOFF_MS * Math.pow(2, attempt);
        if (retryAfter) {
          const seconds = parseInt(retryAfter, 10);
          if (!Number.isNaN(seconds)) {
            waitMs = seconds * 1000;
          }
        }
        console.warn(
          `  ⚠ Rate limit or server error (${status}), retrying in ${Math.round(waitMs / 1000)}s (attempt ${attempt + 1}/${MAX_RETRIES})...`,
        );
        await sleep(waitMs);
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}

/** Default Claude model for action conversion. */
const CLAUDE_MODEL = "claude-sonnet-4-5-20250929";

/**
 * Call Claude (Anthropic) with retry on rate limit (429) and server errors (503).
 * Uses exponential backoff and respects Retry-After when present.
 */
async function convertWithClaude(
  payload: ApiFunctionPayload,
  serviceKey: string,
  apiKey: string,
  defaultDatabaseUrl?: string,
): Promise<ActionJson> {
  const anthropic = new Anthropic({ apiKey });
  const userPrompt = buildUserPrompt(payload, serviceKey, defaultDatabaseUrl);
  let lastError: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await anthropic.messages.create({
        model: CLAUDE_MODEL,
        max_tokens: 4096,
        system: ACTION_TEMPLATE,
        messages: [{ role: "user", content: userPrompt }],
        temperature: 0.2,
      });
      type TextContentBlock = { type: "text"; text: string };
      const textParts = (
        response.content ?? ([] as Array<{ type: string; text?: string }>)
      )
        .filter(
          (block): block is TextContentBlock =>
            block.type === "text" &&
            typeof (block as TextContentBlock).text === "string",
        )
        .map((b: TextContentBlock) => b.text);
      const rawContent = textParts.join("").trim();
      if (!rawContent) {
        throw new Error("Claude returned empty response");
      }
      const content = stripJsonCodeFence(rawContent);
      const parsed = JSON.parse(content) as ActionJson;
      if (!parsed.actionName || !parsed.httpMethod) {
        parsed.actionName =
          parsed.actionName || slugifyActionName(payload.method, payload.url);
        parsed.httpMethod = parsed.httpMethod || payload.method;
      }
      if (!parsed.functionCode && payload.functionCode) {
        parsed.functionCode = payload.functionCode;
      }
      if (!parsed.payloadSchema) {
        parsed.payloadSchema = { type: "object", properties: {}, required: [] };
      }
      if (!parsed.responseSchema) {
        parsed.responseSchema = { type: "object", properties: {} };
      }
      if (!Array.isArray(parsed.systemParameters)) {
        parsed.systemParameters = [];
      }
      parsed.language = "javascript";
      return parsed;
    } catch (err: unknown) {
      lastError = err;
      const status = (err as { status?: number })?.status;
      const isRateLimit = status === 429;
      const isServerError = status === 503;
      const headers = (err as { headers?: Record<string, string> })?.headers;
      const retryAfter = headers?.["retry-after"];
      if ((isRateLimit || isServerError) && attempt < MAX_RETRIES) {
        let waitMs = INITIAL_BACKOFF_MS * Math.pow(2, attempt);
        if (retryAfter) {
          const seconds = parseInt(retryAfter, 10);
          if (!Number.isNaN(seconds)) {
            waitMs = seconds * 1000;
          }
        }
        console.warn(
          `  ⚠ Rate limit or server error (${status}), retrying in ${Math.round(waitMs / 1000)}s (attempt ${attempt + 1}/${MAX_RETRIES})...`,
        );
        await sleep(waitMs);
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}

function actionToSafeFilename(action: ActionJson): string {
  const base = action.actionName.replace(/[^a-zA-Z0-9-_]/g, "_");
  return `${base}.json`;
}

/** action.config.json shape: default database URL (system param name) and service key. */
export interface ActionConfig {
  /** Default system parameter name for database URL (e.g. PLAYGROUND_DATABASE_URL). Used in generated actions' systemParameters. */
  defaultDatabaseUrl?: string;
  /** Default service key (e.g. rm_playground_database). */
  defaultServiceKey?: string;
  /** Alias for defaultServiceKey. */
  serviceKey?: string;
}

const DEFAULT_ACTION_CONFIG_PATH = "action.config.json";

/** Load action.config.json from cwd. */
export async function loadActionConfig(
  cwd: string,
  configPath?: string,
): Promise<ActionConfig> {
  const pathToUse = configPath
    ? path.resolve(configPath)
    : path.join(cwd, DEFAULT_ACTION_CONFIG_PATH);
  try {
    const raw = await fs.readFile(pathToUse, "utf-8");
    return JSON.parse(raw) as ActionConfig;
  } catch {
    return {};
  }
}

export async function handleActions(options: ActionsOptions): Promise<void> {
  if (options.envPath) {
    loadEnv({ path: path.resolve(options.envPath) });
  } else {
    loadEnv();
  }
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;
  const useClaude = Boolean(anthropicKey);
  if (!anthropicKey && !openaiKey) {
    console.error(
      "Error: Set ANTHROPIC_API_KEY (for Claude) or OPENAI_API_KEY (for OpenAI) in your .env file or environment.",
    );
    process.exit(1);
  }

  const inputDir = path.resolve(options.inputDir);
  const outputDir = path.resolve(options.outputDir);
  const actionConfig = await loadActionConfig(
    process.cwd(),
    options.configPath,
  );
  const serviceKey =
    options.serviceKey ??
    actionConfig.defaultServiceKey ??
    actionConfig.serviceKey ??
    "default_service";
  const defaultDatabaseUrl = actionConfig.defaultDatabaseUrl;

  try {
    await fs.access(inputDir);
  } catch {
    console.error(`Error: Input directory not found: ${inputDir}`);
    process.exit(1);
  }

  const payloads = await readApiFunctionFiles(inputDir);
  if (payloads.length === 0) {
    console.log(`No API function JSON files found in ${inputDir}`);
    return;
  }

  await ensureDir(outputDir);
  console.log(
    `Converting ${payloads.length} API function(s) to action JSON (output: ${outputDir})...`,
  );

  if (useClaude) {
    console.log("Using Claude (ANTHROPIC_API_KEY).");
  } else {
    console.log("Using OpenAI (OPENAI_API_KEY).");
  }

  let ok = 0;
  let err = 0;
  const delayMs = DEFAULT_DELAY_BETWEEN_REQUESTS_MS;
  for (let i = 0; i < payloads.length; i++) {
    const payload = payloads[i];
    const label = `${payload.method} ${payload.url}`;
    try {
      let action = useClaude
        ? await convertWithClaude(
            payload,
            serviceKey,
            anthropicKey!,
            defaultDatabaseUrl,
          )
        : await convertWithOpenAI(
            payload,
            serviceKey,
            openaiKey!,
            defaultDatabaseUrl,
          );
      if (options.appName) {
        action = {
          ...action,
          actionName: applyAppNameToActionName(
            action.actionName,
            options.appName,
          ),
        };
      }
      const filename = actionToSafeFilename(action);
      const outPath = path.join(outputDir, filename);
      await fs.writeFile(outPath, JSON.stringify(action, null, 2), "utf-8");
      ok++;
      console.log(`  ✓ ${label} → ${filename}`);
    } catch (e) {
      err++;
      console.error(
        `  ✗ ${label}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    // Pace requests to avoid rate limits (skip delay after last item)
    if (i < payloads.length - 1 && delayMs > 0) {
      await sleep(delayMs);
    }
  }

  console.log(`\nDone. ${ok} written, ${err} failed.`);
}
