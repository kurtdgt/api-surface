/**
 * Extract required system parameters (e.g. process.env vars) from API call function code.
 */

import type { ApiCall } from "@api-surface/types";

/** Matches process.env.NAME (identifier) */
const ENV_DOT_RE = /process\.env\.([A-Z_][A-Z0-9_]*)/gi;
/** Matches process.env["NAME"] or process.env['NAME'] */
const ENV_BRACKET_RE = /process\.env\s*\[\s*["']([^"']+)["']\s*\]/g;

export interface SystemParamWithContext {
  name: string;
  /** Short code snippet where this param is used (for AI description). */
  codeSnippet?: string;
}

/**
 * Extract unique system parameter names from apiCalls' functionCode,
 * and optionally a short code snippet for each (first occurrence).
 */
export function extractSystemParamsFromApiCalls(
  apiCalls: ApiCall[],
): SystemParamWithContext[] {
  const byName = new Map<string, string>();

  for (const call of apiCalls) {
    const code = call.functionCode;
    if (!code || typeof code !== "string") continue;

    // process.env.VAR_NAME
    let m: RegExpExecArray | null;
    ENV_DOT_RE.lastIndex = 0;
    while ((m = ENV_DOT_RE.exec(code)) !== null) {
      const name = m[1];
      if (!byName.has(name)) {
        byName.set(name, getSnippet(code, m.index));
      }
    }

    // process.env["VAR_NAME"] or process.env['VAR_NAME']
    ENV_BRACKET_RE.lastIndex = 0;
    while ((m = ENV_BRACKET_RE.exec(code)) !== null) {
      const name = m[1].trim();
      if (!byName.has(name)) {
        byName.set(name, getSnippet(code, m.index));
      }
    }
  }

  return Array.from(byName.entries())
    .map(([name, codeSnippet]) => ({ name, codeSnippet }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Get a short snippet around the given index (single line or a few lines). */
function getSnippet(code: string, index: number, maxLen = 200): string {
  const start = Math.max(0, index - 40);
  let end = code.indexOf("\n", index);
  if (end === -1) end = code.length;
  end = Math.min(code.length, end + 80);
  let snippet = code.slice(start, end).replace(/\s+/g, " ").trim();
  if (snippet.length > maxLen) {
    snippet = snippet.slice(0, maxLen) + "...";
  }
  return snippet;
}
