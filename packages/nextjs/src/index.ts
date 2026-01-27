/**
 * Next.js-specific adapter
 */

import { ApiScanner } from '@api-surface/core';
import { ScanConfig, ScanResult } from '@api-surface/types';

export class NextjsApiScanner extends ApiScanner {
  constructor(config: ScanConfig) {
    super(config);
    // TODO: Extend base scanner with Next.js-specific detection
  }

  /**
   * Override scan to add Next.js-specific patterns
   */
  async scan(): Promise<ScanResult> {
    // TODO: Add Next.js route handlers, API routes, server components detection
    return super.scan();
  }
}
