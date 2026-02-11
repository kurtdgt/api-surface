/**
 * Use AI to discover dependencies of API route files (imports, env vars)
 * so the scanner does not miss any related files.
 */

import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import * as fs from "fs/promises";
import * as fsSync from "fs";
import * as path from "path";
import { getFilesInApiDir } from "@api-surface/core";

const MAX_LINES_PER_FILE = 80;
const MAX_TOTAL_FILES = 50;

export interface DiscoveredDependencies {
  /** File paths relative to repo root that the API code depends on */
  filePaths: string[];
  /** Environment variable names used */
  envVars: string[];
}

const SYSTEM_PROMPT = `You analyze API route handler code (e.g. Next.js route.ts files) and list dependencies.

For each code snippet (labeled with its file path), identify:
1. filePaths: every file that is imported or required, as paths relative to the repo root (e.g. "src/lib/db.ts", "lib/auth.ts"). Include only files that are clearly internal to the project (no node_modules). Use forward slashes.
2. envVars: every environment variable read (e.g. process.env.DATABASE_URL, process.env.API_KEY).

Output valid JSON only, no markdown or code fence:
{ "filePaths": ["path/one.ts", "path/two.ts"], "envVars": ["VAR1", "VAR2"] }

Merge results from all snippets into a single list (no duplicates).`;

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

/**
 * Read file content and return a short snippet (path + first N lines).
 */
async function readSnippet(
  absolutePath: string,
  rootDir: string,
  maxLines: number
): Promise<{ path: string; content: string }> {
  const content = await fs.readFile(absolutePath, "utf-8").catch(() => "");
  const lines = content.split(/\r?\n/).slice(0, maxLines);
  const relPath = path.relative(rootDir, absolutePath);
  return {
    path: relPath,
    content: lines.join("\n"),
  };
}

/**
 * Resolve a path relative to repo root to an absolute path; try with common extensions.
 */
export function resolveDiscoveredPath(
  relPath: string,
  rootDir: string
): string | null {
  const normalized = path.normalize(relPath).replace(/^\.[/\\]/, "");
  const abs = path.resolve(rootDir, normalized);
  const ext = path.extname(abs);
  const exts = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];
  const toTry = ext && exts.includes(ext) ? [abs] : exts.map((e) => abs + e);
  for (const p of toTry) {
    try {
      const stat = fsSync.statSync(p);
      if (stat.isFile()) return p;
    } catch {
      // continue
    }
  }
  const dirIndex = path.join(abs, "index.ts");
  if (fsSync.existsSync(dirIndex)) return dirIndex;
  return null;
}

/**
 * Discover dependencies of API directory files using AI.
 * Returns file paths (relative) and env var names; caller should resolve paths to absolute and add to scan.
 */
export async function discoverApiDependenciesWithAi(
  rootDir: string,
  apiRoutesDir: string,
  options: { anthropicKey?: string; openaiKey?: string }
): Promise<DiscoveredDependencies> {
  const anthropicKey = options.anthropicKey?.trim();
  const openaiKey = options.openaiKey?.trim();
  if (!anthropicKey && !openaiKey) {
    return { filePaths: [], envVars: [] };
  }

  const apiDirFiles = await getFilesInApiDir(rootDir, apiRoutesDir);
  if (apiDirFiles.length === 0) {
    return { filePaths: [], envVars: [] };
  }

  const toAnalyze = apiDirFiles.slice(0, MAX_TOTAL_FILES);
  const snippets: { path: string; content: string }[] = [];
  for (const filePath of toAnalyze) {
    const snip = await readSnippet(filePath, rootDir, MAX_LINES_PER_FILE);
    snippets.push(snip);
  }

  const userContent = snippets
    .map(
      (s) =>
        `--- File: ${s.path} ---\n${s.content}`
    )
    .join("\n\n");

  const userPrompt = `Analyze these API route files and list all dependencies (internal file imports and env vars):\n\n${userContent}`;

  let rawContent: string;

  if (anthropicKey) {
    const anthropic = new Anthropic({ apiKey: anthropicKey });
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
      temperature: 0.2,
    });
    const textParts = (response.content ?? [])
      .filter(
        (block): block is { type: "text"; text: string } =>
          block.type === "text" && typeof (block as { text?: string }).text === "string"
      )
      .map((b) => b.text);
    rawContent = textParts.join("").trim();
  } else {
    const openai = new OpenAI({ apiKey: openaiKey! });
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      max_tokens: 2048,
      temperature: 0.2,
    });
    rawContent = response.choices[0]?.message?.content?.trim() ?? "";
  }

  if (!rawContent) return { filePaths: [], envVars: [] };

  const content = stripJsonCodeFence(rawContent);
  try {
    const parsed = JSON.parse(content) as {
      filePaths?: string[];
      envVars?: string[];
    };
    const filePaths = Array.isArray(parsed.filePaths)
      ? parsed.filePaths.filter((p) => typeof p === "string")
      : [];
    const envVars = Array.isArray(parsed.envVars)
      ? parsed.envVars.filter((p) => typeof p === "string")
      : [];
    return { filePaths: [...new Set(filePaths)], envVars: [...new Set(envVars)] };
  } catch {
    return { filePaths: [], envVars: [] };
  }
}
