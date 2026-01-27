/**
 * Open command - view/explore a scan result in web viewer
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { startViewerServer } from '../viewer/server';

export interface OpenOptions {
  port?: number;
  format?: string;
  filter?: string;
}

export async function handleOpen(scanPath: string, options: OpenOptions): Promise<void> {
  try {
    // Resolve scan file path
    const filePath = scanPath
      ? path.resolve(process.cwd(), scanPath)
      : await findLatestScanResult();

    if (!filePath) {
      console.error('Error: No scan result file specified and no recent scan found.');
      console.error('Please run "api-surface scan" first or specify a scan file path.');
      process.exit(1);
    }

    // Verify file exists
    try {
      await fs.access(filePath);
    } catch {
      console.error(`Error: Scan file not found: ${filePath}`);
      process.exit(1);
    }

    // Start web viewer server
    await startViewerServer({
      scanFilePath: filePath,
      port: options.port,
      openBrowser: true,
    });
  } catch (error) {
    console.error('Error opening scan result:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

/**
 * Find the most recent scan result file
 */
async function findLatestScanResult(): Promise<string | null> {
  const cwd = process.cwd();
  const commonNames = [
    'api-surface-result.json',
    'scan-result.json',
    'api-calls.json',
  ];

  // Try common names first
  for (const name of commonNames) {
    const filePath = path.join(cwd, name);
    try {
      await fs.access(filePath);
      return filePath;
    } catch {
      // File doesn't exist, continue
    }
  }

  // Try to find any JSON file that looks like a scan result
  try {
    const files = await fs.readdir(cwd);
    const jsonFiles = files
      .filter(f => f.endsWith('.json'))
      .map(f => path.join(cwd, f));

    // Check if any look like scan results (contain "endpoints" or "summary")
    for (const filePath of jsonFiles) {
      try {
        const content = await fs.readFile(filePath, 'utf-8');
        const data = JSON.parse(content);
        if (data.endpoints || data.summary) {
          return filePath;
        }
      } catch {
        // Not a valid JSON or scan result, continue
      }
    }
  } catch {
    // Can't read directory, return null
  }

  return null;
}
