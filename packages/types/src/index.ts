/**
 * Shared types for api-surface
 */

export interface ApiCall {
  method: string;
  url: string;
  line: number;
  column: number;
  file: string;
  source: 'fetch' | 'axios' | 'custom';
}

export interface ScanConfig {
  rootDir: string;
  include?: string[];
  exclude?: string[];
  framework?: 'none' | 'nextjs';
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
