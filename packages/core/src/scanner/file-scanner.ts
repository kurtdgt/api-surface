/**
 * File system scanning layer
 * Scans files using fast-glob and respects include/exclude patterns
 */

import fg from 'fast-glob';
import * as path from 'path';
import { ScanConfig } from '@api-surface/types';

export interface FileScanResult {
  files: string[];
  count: number;
}

/**
 * Default ignore patterns that should always be excluded
 */
const DEFAULT_IGNORE_PATTERNS = [
  '**/node_modules/**',
  '**/.git/**',
  '**/.svn/**',
  '**/.hg/**',
  '**/dist/**',
  '**/build/**',
  '**/.next/**',
  '**/.nuxt/**',
  '**/.cache/**',
  '**/coverage/**',
  '**/.nyc_output/**',
  '**/.vscode/**',
  '**/.idea/**',
  '**/.DS_Store',
];

/**
 * Scan files based on configuration
 * Returns absolute file paths ready for AST parsing
 */
export async function scanFiles(config: ScanConfig): Promise<FileScanResult> {
  const { rootDir, include, exclude } = config;

  // Build include patterns - use config or defaults
  const includePatterns = include && include.length > 0 
    ? include 
    : ['**/*.{js,jsx,ts,tsx}'];

  // Build exclude patterns - merge defaults with config excludes
  const excludePatterns = [
    ...DEFAULT_IGNORE_PATTERNS,
    ...(exclude || []),
  ];

  // Ensure patterns are relative to rootDir
  const normalizedInclude = includePatterns.map(pattern => 
    path.isAbsolute(pattern) ? pattern : pattern
  );

  // Scan files using fast-glob
  const files = await fg(normalizedInclude, {
    cwd: rootDir,
    ignore: excludePatterns,
    absolute: true, // Return absolute paths
    onlyFiles: true, // Only files, not directories
    caseSensitiveMatch: false,
    dot: false, // Don't include dot files by default
  });

  // Sort for consistent output
  const sortedFiles = files.sort();

  return {
    files: sortedFiles,
    count: sortedFiles.length,
  };
}

/**
 * Validate that a file path is within the root directory
 * (Security check to prevent directory traversal)
 */
export function validateFilePath(filePath: string, rootDir: string): boolean {
  const normalizedRoot = path.resolve(rootDir);
  const normalizedFile = path.resolve(filePath);
  return normalizedFile.startsWith(normalizedRoot + path.sep) || 
         normalizedFile === normalizedRoot;
}

/**
 * Get file extension for filtering
 */
export function getFileExtension(filePath: string): string {
  return path.extname(filePath).toLowerCase();
}

/**
 * Check if file extension is supported for scanning
 */
export function isSupportedFile(filePath: string): boolean {
  const ext = getFileExtension(filePath);
  return ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'].includes(ext);
}
