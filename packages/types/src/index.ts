/**
 * Shared types for api-surface
 */

/**
 * Confidence for function code resolution (static analysis).
 * - high: function directly contains the API call
 * - medium: imported local function resolved
 * - low: fallback or partial extraction
 */
export type FunctionResolutionConfidence = "high" | "medium" | "low";

export interface ApiCall {
  method: string;
  url: string;
  line: number;
  column: number;
  file: string;
  source: "fetch" | "axios" | "custom";
  confidence?: "high" | "medium" | "low";
  /** Name of the function that contains the API call (if resolved) */
  functionName?: string;
  /** File path where the function is defined */
  functionFile?: string;
  /** Full source code of the function (best-effort, static analysis only) */
  functionCode?: string | null;
  /** Confidence of function code resolution */
  functionResolutionConfidence?: FunctionResolutionConfidence;
}

/**
 * Normalized API endpoint - groups multiple call sites
 */
export interface NormalizedEndpoint {
  method: string;
  url: string;
  source: "fetch" | "axios" | "custom";
  callSites: CallSite[];
  confidence: "high" | "medium" | "low";
  callCount: number;
}

/**
 * Call site metadata
 */
export interface CallSite {
  file: string;
  line: number;
  column: number;
  confidence?: "high" | "medium" | "low";
}

export interface ScanConfig {
  rootDir: string;
  include?: string[];
  exclude?: string[];
  framework?: "none" | "nextjs" | "next" | "react" | "react-native" | "generic";
  apiClients?: ApiClientConfig[];
  /** If set, write one JSON file per endpoint with function code(s) into this directory */
  functionCodeOutputDir?: string;
  /** Max lines to extract per function (default 300). Do not extract entire files. */
  maxFunctionLines?: number;
  /** Directory where API route handlers live (e.g. Next.js App Router "src/app/api"). When set, functionCode is taken from the route handler for the called URL, not the caller. */
  apiRoutesDir?: string;
}

export interface ApiClientConfig {
  type: "fetch" | "axios" | "custom";
  name?: string; // For custom clients
  patterns?: string[]; // Import patterns to detect (e.g., ['axios', '@/lib/api'])
}

/** A required system parameter (e.g. env var) inferred from scanned code, with optional AI-generated description. */
export interface RequiredSystemParam {
  name: string;
  description?: string;
}

export interface ScanResult {
  apiCalls: ApiCall[];
  filesScanned: number;
  errors: ScanError[];
  /** Required system parameters (e.g. process.env vars) inferred from API route handlers, with optional descriptions. */
  requiredSystemParams?: RequiredSystemParam[];
}

export interface ScanError {
  file: string;
  message: string;
  line?: number;
}
