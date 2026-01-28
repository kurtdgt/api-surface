/**
 * Shared types for api-surface
 */

export interface ApiCall {
  method: string;
  url: string;
  line: number;
  column: number;
  file: string;
  source: "fetch" | "axios" | "custom";
  confidence?: "high" | "medium" | "low";
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
}

export interface ApiClientConfig {
  type: "fetch" | "axios" | "custom";
  name?: string; // For custom clients
  patterns?: string[]; // Import patterns to detect (e.g., ['axios', '@/lib/api'])
}

export interface ScanResult {
  apiCalls: ApiCall[];
  filesScanned: number;
  errors: ScanError[];
}

export interface ScanError {
  file: string;
  message: string;
  line?: number;
}
