/**
 * Terminal summary output formatter
 */

import { ScanResult } from '@api-surface/types';
import { NormalizedResult, normalizeResults } from './normalize';

/**
 * Format scan results as a terminal summary
 */
export function formatSummary(scanResult: ScanResult): string {
  const normalized = normalizeResults(scanResult.apiCalls);
  
  const lines: string[] = [];
  
  // Header
  lines.push('');
  lines.push('═'.repeat(60));
  lines.push('  API Surface Scan Results');
  lines.push('═'.repeat(60));
  lines.push('');

  // Overview
  lines.push('Overview:');
  lines.push(`  Total API calls found:     ${normalized.totalCalls}`);
  lines.push(`  Unique endpoints:           ${normalized.uniqueEndpoints}`);
  lines.push(`  Files scanned:              ${scanResult.filesScanned}`);
  if (scanResult.errors.length > 0) {
    lines.push(`  Errors encountered:         ${scanResult.errors.length}`);
  }
  lines.push('');

  // By method
  if (Object.keys(normalized.byMethod).length > 0) {
    lines.push('By HTTP Method:');
    const sortedMethods = Object.entries(normalized.byMethod)
      .sort((a, b) => b[1] - a[1]);
    for (const [method, count] of sortedMethods) {
      lines.push(`  ${method.padEnd(8)} ${count}`);
    }
    lines.push('');
  }

  // By source
  if (Object.keys(normalized.bySource).length > 0) {
    lines.push('By Source:');
    const sortedSources = Object.entries(normalized.bySource)
      .sort((a, b) => b[1] - a[1]);
    for (const [source, count] of sortedSources) {
      lines.push(`  ${source.padEnd(8)} ${count}`);
    }
    lines.push('');
  }

  // By confidence
  if (Object.keys(normalized.byConfidence).length > 0) {
    lines.push('By Confidence:');
    const confidenceOrder: Array<'high' | 'medium' | 'low'> = ['high', 'medium', 'low'];
    for (const level of confidenceOrder) {
      const count = normalized.byConfidence[level] || 0;
      if (count > 0) {
        const emoji = level === 'high' ? '✓' : level === 'medium' ? '~' : '?';
        lines.push(`  ${emoji} ${level.padEnd(8)} ${count}`);
      }
    }
    lines.push('');
  }

  // Top endpoints
  if (normalized.endpoints.length > 0) {
    lines.push('Top Endpoints:');
    const topEndpoints = normalized.endpoints
      .sort((a, b) => b.callCount - a.callCount)
      .slice(0, 10);
    
    for (const endpoint of topEndpoints) {
      const confidenceEmoji = endpoint.confidence === 'high' ? '✓' : 
                             endpoint.confidence === 'medium' ? '~' : '?';
      lines.push(
        `  ${endpoint.method.padEnd(8)} ${endpoint.url.padEnd(40)} ` +
        `${confidenceEmoji} (${endpoint.callCount} call${endpoint.callCount > 1 ? 's' : ''})`
      );
    }
    lines.push('');
  }

  // Errors summary
  if (scanResult.errors.length > 0) {
    lines.push('Errors:');
    for (const error of scanResult.errors.slice(0, 5)) {
      const fileName = error.file.split('/').pop() || error.file;
      lines.push(`  ${fileName}:${error.line || '?'} - ${error.message}`);
    }
    if (scanResult.errors.length > 5) {
      lines.push(`  ... and ${scanResult.errors.length - 5} more`);
    }
    lines.push('');
  }

  lines.push('═'.repeat(60));
  lines.push('');

  return lines.join('\n');
}
