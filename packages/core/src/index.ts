/**
 * Core scanner - framework-agnostic API call detection
 */

import { ScanConfig, ScanResult } from '@api-surface/types';

export class ApiScanner {
  constructor(private config: ScanConfig) {}

  /**
   * Scan the repository for API calls
   */
  async scan(): Promise<ScanResult> {
    // TODO: Implement scanning logic
    return {
      apiCalls: [],
      filesScanned: 0,
      errors: [],
    };
  }
}

export * from '@api-surface/types';
