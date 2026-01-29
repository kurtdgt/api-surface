/**
 * Result writer - output normalized results to JSON
 */

import * as fs from "fs/promises";
import * as path from "path";
import { ScanResult, ApiCall } from "@api-surface/types";
import { NormalizedResult, normalizeResults } from "./normalize";

/**
 * Per-endpoint JSON shape when writing one file per endpoint (function code storage).
 * Each call site includes function extraction fields when available.
 */
export interface EndpointFunctionCodePayload {
  method: string;
  url: string;
  callSites: Array<{
    file: string;
    line: number;
    column: number;
    confidence?: string;
    functionName?: string;
    functionFile?: string;
    functionCode?: string | null;
    functionResolutionConfidence?: string;
  }>;
}

/**
 * API-function-only payload: one per endpoint, no frontend call sites.
 * Used when apiRoutesDir is set (focus on the route handler in src/app/api).
 */
export interface ApiFunctionOnlyPayload {
  method: string;
  url: string;
  functionName?: string;
  functionFile?: string;
  functionCode?: string | null;
  functionResolutionConfidence?: string;
}

export interface WriteOptions {
  outputPath: string;
  includeRaw?: boolean;
  pretty?: boolean;
}

export interface OutputData {
  summary: {
    totalCalls: number;
    uniqueEndpoints: number;
    filesScanned: number;
    errors: number;
    byMethod: Record<string, number>;
    bySource: Record<string, number>;
    byConfidence: Record<string, number>;
  };
  endpoints: NormalizedResult["endpoints"];
  errors?: ScanResult["errors"];
  rawCalls?: ScanResult["apiCalls"];
}

/**
 * Write normalized results to JSON file
 */
export async function writeResults(
  scanResult: ScanResult,
  options: WriteOptions,
): Promise<void> {
  // Normalize results
  const normalized = normalizeResults(scanResult.apiCalls);

  // Prepare output data
  const outputData: OutputData = {
    summary: {
      totalCalls: normalized.totalCalls,
      uniqueEndpoints: normalized.uniqueEndpoints,
      filesScanned: scanResult.filesScanned,
      errors: scanResult.errors.length,
      byMethod: normalized.byMethod,
      bySource: normalized.bySource,
      byConfidence: normalized.byConfidence,
    },
    endpoints: normalized.endpoints,
  };

  // Include errors if any
  if (scanResult.errors.length > 0) {
    outputData.errors = scanResult.errors;
  }

  // Include raw calls if requested
  if (options.includeRaw) {
    outputData.rawCalls = scanResult.apiCalls;
  }

  // Write to file
  const json =
    options.pretty !== false
      ? JSON.stringify(outputData, null, 2)
      : JSON.stringify(outputData);

  const outputPath = path.resolve(options.outputPath);
  await fs.writeFile(outputPath, json, "utf-8");
}

/**
 * Create a safe filename for an endpoint (method + url).
 * Example: GET_https_api.example.com_users -> GET_https_api_example_com_users.json
 */
function endpointToSafeFilename(method: string, url: string): string {
  const safeUrl = url
    .replace(/[^a-zA-Z0-9/_-]/g, "_")
    .replace(/\/+/g, "_")
    .slice(0, 120);
  return `${method.toUpperCase()}_${safeUrl}.json`;
}

/**
 * Write one JSON file per endpoint into outputDir.
 * When apiFunctionOnly is true (e.g. when apiRoutesDir is set), writes only the API function
 * (method, url, functionName, functionFile, functionCode) with no frontend call sites.
 * When apiRoutesDir and rootDir are set, only writes endpoints whose handler was resolved
 * from that directory (functionFile under rootDir/apiRoutesDir); skips external URLs and
 * callers outside the API directory.
 */
export async function writeFunctionCodePerEndpoint(
  apiCalls: ApiCall[],
  outputDir: string,
  options?: {
    pretty?: boolean;
    apiFunctionOnly?: boolean;
    /** When set with apiFunctionOnly, only write endpoints resolved from this dir (e.g. "src/app/api") */
    apiRoutesDir?: string;
    /** Project root; used with apiRoutesDir to filter by functionFile path */
    rootDir?: string;
  },
): Promise<void> {
  const pretty = options?.pretty !== false;
  const apiFunctionOnly = options?.apiFunctionOnly === true;
  const apiRoutesDir = options?.apiRoutesDir;
  const rootDir = options?.rootDir ?? ".";
  const resolvedDir = path.resolve(outputDir);
  await fs.mkdir(resolvedDir, { recursive: true });

  /** Only include endpoints whose handler was resolved from apiRoutesDir (under rootDir/apiRoutesDir). */
  const apiRoutesAbsolute =
    apiRoutesDir && rootDir
      ? path.normalize(path.resolve(rootDir, apiRoutesDir)) + path.sep
      : "";

  const endpointMap = new Map<string, ApiCall[]>();
  for (const call of apiCalls) {
    const key = `${call.method.toUpperCase()}:${call.url}`;
    if (!endpointMap.has(key)) {
      endpointMap.set(key, []);
    }
    endpointMap.get(key)!.push(call);
  }

  for (const [, calls] of endpointMap) {
    const first = calls[0];
    if (apiFunctionOnly && apiRoutesAbsolute) {
      const resolvedFromApi =
        first.functionFile &&
        path.normalize(first.functionFile).startsWith(apiRoutesAbsolute);
      if (!resolvedFromApi) continue;
    }

    const method = first.method;
    const url = first.url;
    const filename = endpointToSafeFilename(method, url);
    const filePath = path.join(resolvedDir, filename);

    if (apiFunctionOnly) {
      const payload: ApiFunctionOnlyPayload = {
        method,
        url,
        functionName: first.functionName,
        functionFile: first.functionFile,
        functionCode: first.functionCode,
        functionResolutionConfidence: first.functionResolutionConfidence,
      };
      const json = pretty
        ? JSON.stringify(payload, null, 2)
        : JSON.stringify(payload);
      await fs.writeFile(filePath, json, "utf-8");
    } else {
      const payload: EndpointFunctionCodePayload = {
        method,
        url,
        callSites: calls.map((c) => ({
          file: c.file,
          line: c.line,
          column: c.column,
          confidence: c.confidence,
          functionName: c.functionName,
          functionFile: c.functionFile,
          functionCode: c.functionCode,
          functionResolutionConfidence: c.functionResolutionConfidence,
        })),
      };
      const json = pretty
        ? JSON.stringify(payload, null, 2)
        : JSON.stringify(payload);
      await fs.writeFile(filePath, json, "utf-8");
    }
  }
}
