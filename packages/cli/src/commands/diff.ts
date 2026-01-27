/**
 * Diff command - compare two scan results
 */

import { ScanResult } from '@api-surface/types';
import * as fs from 'fs/promises';
import * as path from 'path';

export interface DiffOptions {
  output?: string;
}

export async function handleDiff(
  baselinePath: string,
  currentPath: string,
  options: DiffOptions
): Promise<void> {
  try {
    // Load both scan results
    const baselineFile = path.resolve(process.cwd(), baselinePath);
    const currentFile = path.resolve(process.cwd(), currentPath);

    let baseline: ScanResult;
    let current: ScanResult;

    try {
      const baselineContent = await fs.readFile(baselineFile, 'utf-8');
      baseline = JSON.parse(baselineContent);
    } catch (error) {
      console.error(`Error: Failed to load baseline from ${baselineFile}`);
      process.exit(1);
    }

    try {
      const currentContent = await fs.readFile(currentFile, 'utf-8');
      current = JSON.parse(currentContent);
    } catch (error) {
      console.error(`Error: Failed to load current scan from ${currentFile}`);
      process.exit(1);
    }

    // Calculate diff
    console.log('Comparing scan results...');
    const diff = calculateDiff(baseline, current);

    // Output diff
    const output = JSON.stringify(diff, null, 2);

    if (options.output) {
      const outputPath = path.resolve(process.cwd(), options.output);
      await fs.writeFile(outputPath, output, 'utf-8');
      console.log(`\n✓ Diff complete! Results saved to ${outputPath}`);
      console.log(`  Added: ${diff.added.length}, Removed: ${diff.removed.length}, Changed: ${diff.changed.length}`);
    } else {
      console.log('\n' + output);
    }
  } catch (error) {
    console.error('Error during diff:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

interface DiffResult {
  added: Array<{ file: string; method: string; url: string }>;
  removed: Array<{ file: string; method: string; url: string }>;
  changed: Array<{ file: string; method: string; url: string; oldUrl: string }>;
}

function calculateDiff(baseline: ScanResult, current: ScanResult): DiffResult {
  // TODO: Implement diff logic
  // For now, return empty diff
  return {
    added: [],
    removed: [],
    changed: [],
  };
}
