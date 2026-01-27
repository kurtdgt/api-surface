/**
 * Scan command - scan a directory for API calls
 */

import { ScanConfig, ScanResult } from '@api-surface/types';
import { ApiScanner } from '@api-surface/core';
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

    // Load config if provided
    let config: ScanConfig = {
      rootDir,
      framework: (options.framework as 'none' | 'nextjs') || 'none',
    };

    if (options.config) {
      const configPath = path.resolve(process.cwd(), options.config);
      try {
        const configContent = await fs.readFile(configPath, 'utf-8');
        const fileConfig = JSON.parse(configContent);
        config = { ...config, ...fileConfig };
      } catch (error) {
        console.error(`Error: Failed to load config from ${configPath}`);
        process.exit(1);
      }
    }

    // Perform scan
    console.log(`Scanning ${rootDir}...`);
    const scanner = new ApiScanner(config);
    const result: ScanResult = await scanner.scan();

    // Output results
    const output = JSON.stringify(result, null, 2);

    if (options.output) {
      const outputPath = path.resolve(process.cwd(), options.output);
      await fs.writeFile(outputPath, output, 'utf-8');
      console.log(`\n✓ Scan complete! Results saved to ${outputPath}`);
      console.log(`  Found ${result.apiCalls.length} API calls in ${result.filesScanned} files`);
      if (result.errors.length > 0) {
        console.log(`  ⚠ ${result.errors.length} errors encountered`);
      }
    } else {
      console.log('\n' + output);
    }
  } catch (error) {
    console.error('Error during scan:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
