/**
 * Configuration handling
 */

import { ScanConfig } from '@api-surface/types';

export function loadConfig(configPath?: string): ScanConfig {
  // TODO: Load config from file or use defaults
  throw new Error('Not implemented');
}

export function validateConfig(config: ScanConfig): void {
  // TODO: Validate configuration
  throw new Error('Not implemented');
}
