/**
 * Configuration validator
 */

import { ScanConfig } from '@api-surface/types';
import { ScanConfigSchema } from './schema';

/**
 * Validate a configuration object
 */
export function validateConfig(config: unknown): ScanConfig {
  try {
    return ScanConfigSchema.parse(config) as ScanConfig;
  } catch (error) {
    if (error instanceof Error && error.name === 'ZodError') {
      const zodError = error as any;
      const messages = zodError.errors.map((err: any) => {
        const path = err.path.join('.');
        return `  - ${path}: ${err.message}`;
      }).join('\n');
      
      throw new Error(
        `Invalid configuration:\n${messages}\n\n` +
        `Please check your config file and ensure all fields match the expected schema.`
      );
    }
    throw new Error(`Configuration validation failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}
