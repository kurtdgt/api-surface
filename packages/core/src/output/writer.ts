/**
 * Result writer - output normalized results to JSON
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { ScanResult } from '@api-surface/types';
import { NormalizedResult, normalizeResults } from './normalize';

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
  endpoints: NormalizedResult['endpoints'];
  errors?: ScanResult['errors'];
  rawCalls?: ScanResult['apiCalls'];
}

/**
 * Write normalized results to JSON file
 */
export async function writeResults(
  scanResult: ScanResult,
  options: WriteOptions
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
  const json = options.pretty !== false
    ? JSON.stringify(outputData, null, 2)
    : JSON.stringify(outputData);

  const outputPath = path.resolve(options.outputPath);
  await fs.writeFile(outputPath, json, 'utf-8');
}
