/**
 * Scan command - scan a directory for API calls
 */

import { ScanResult } from '@api-surface/types';
import { ApiScanner } from '@api-surface/core';
// @ts-ignore - loadConfig export exists but dist needs rebuild
import { loadConfig, writeResults, formatSummary } from '@api-surface/core';
import * as fs from 'fs/promises';
import * as path from 'path';

export interface ScanOptions {
  root?: string;
  config?: string;
  framework?: string;
  output?: string;
}

export async function handleScan(directory: string, options: ScanOptions): Promise<void> {
  try {
    // Resolve root directory
    const rootDir = options.root 
      ? path.resolve(process.cwd(), options.root)
      : path.resolve(process.cwd(), directory);

    // Validate directory exists
    try {
      const stats = await fs.stat(rootDir);
      if (!stats.isDirectory()) {
        console.error(`Error: ${rootDir} is not a directory`);
        process.exit(1);
      }
    } catch (error) {
      console.error(`Error: Directory not found: ${rootDir}`);
      process.exit(1);
    }

    // Load config using the new config loader
    const config = await loadConfig({
      rootDir,
      configPath: options.config,
    });

    // Override framework if provided via CLI
    if (options.framework) {
      config.framework = options.framework as any;
    }

    console.log(`Using config from: ${options.config || 'defaults'}`);

    // Perform scan
    console.log(`Scanning ${rootDir}...`);
    const scanner = new ApiScanner(config);
    const result: ScanResult = await scanner.scan();

    // Output results
    if (options.output) {
      // Write normalized JSON output
      const outputPath = path.resolve(process.cwd(), options.output);
      await writeResults(result, {
        outputPath,
        includeRaw: false,
        pretty: true,
      });

      // Display summary
      const summary = formatSummary(result);
      console.log(summary);
      console.log(`\n✓ Results saved to ${outputPath}`);
    } else {
      // Display summary only
      const summary = formatSummary(result);
      console.log(summary);
    }
  } catch (error) {
    console.error('Error during scan:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
