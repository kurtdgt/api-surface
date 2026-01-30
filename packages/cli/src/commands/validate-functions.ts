/**
 * Validate function JSON files (API function payloads).
 * Checks valid JSON and required fields: method, url.
 * Optionally --fix: rewrite files with consistent formatting.
 */

import * as fs from "fs/promises";
import * as path from "path";

export interface ApiFunctionPayload {
  method: string;
  url: string;
  functionName?: string;
  functionFile?: string;
  functionCode?: string | null;
  functionResolutionConfidence?: string;
}

export interface ValidateFunctionsOptions {
  /** Directory containing API function JSON files */
  inputDir: string;
  /** If true, rewrite valid files with consistent JSON formatting */
  fix?: boolean;
}

export interface ValidationResult {
  file: string;
  ok: boolean;
  error?: string;
}

export async function validateFunctionFile(
  filePath: string,
  raw: string,
): Promise<
  { ok: true; data: ApiFunctionPayload } | { ok: false; error: string }
> {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Invalid JSON",
    };
  }
  if (!data || typeof data !== "object") {
    return { ok: false, error: "Not a JSON object" };
  }
  const obj = data as Record<string, unknown>;
  if (typeof obj.method !== "string") {
    return { ok: false, error: "Missing or invalid 'method' (must be string)" };
  }
  if (typeof obj.url !== "string") {
    return { ok: false, error: "Missing or invalid 'url' (must be string)" };
  }
  return {
    ok: true,
    data: data as ApiFunctionPayload,
  };
}

export async function handleValidateFunctions(
  options: ValidateFunctionsOptions,
): Promise<void> {
  const inputDir = path.resolve(options.inputDir);
  let entries: Array<{ name: string; isFile: () => boolean }>;
  try {
    entries = await fs.readdir(inputDir, { withFileTypes: true });
  } catch (e) {
    console.error(`Error: Cannot read directory ${inputDir}:`, e);
    process.exit(1);
  }

  const jsonFiles = entries
    .filter((e) => e.isFile() && e.name.endsWith(".json"))
    .map((e) => e.name);

  if (jsonFiles.length === 0) {
    console.log(`No JSON files found in ${inputDir}`);
    return;
  }

  const results: ValidationResult[] = [];
  const validData: Array<{ file: string; data: ApiFunctionPayload }> = [];

  for (const name of jsonFiles) {
    const filePath = path.join(inputDir, name);
    const raw = await fs.readFile(filePath, "utf-8");
    const result = await validateFunctionFile(filePath, raw);
    if (result.ok) {
      results.push({ file: name, ok: true });
      validData.push({ file: name, data: result.data });
    } else {
      results.push({ file: name, ok: false, error: result.error });
    }
  }

  const invalid = results.filter((r) => !r.ok);
  const valid = results.filter((r) => r.ok);

  if (invalid.length > 0) {
    console.error("Invalid JSON or schema:\n");
    for (const r of invalid) {
      console.error(`  ${r.file}: ${r.error}`);
    }
    console.error("");
  }

  console.log(`Valid: ${valid.length}, Invalid: ${invalid.length}`);

  if (options.fix && validData.length > 0) {
    for (const { file, data } of validData) {
      const filePath = path.join(inputDir, file);
      await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
      console.log(`  Fixed (normalized): ${file}`);
    }
  }

  if (invalid.length > 0) {
    process.exit(1);
  }
}
