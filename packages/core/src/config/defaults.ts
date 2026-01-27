/**
 * Default configuration values
 */

import { ScanConfig } from '@api-surface/types';

export const DEFAULT_CONFIG: Partial<ScanConfig> = {
  include: ['**/*.{js,jsx,ts,tsx}'],
  exclude: [
    '**/node_modules/**',
    '**/dist/**',
    '**/build/**',
    '**/.next/**',
    '**/coverage/**',
    '**/*.test.{js,jsx,ts,tsx}',
    '**/*.spec.{js,jsx,ts,tsx}',
  ],
  framework: 'generic',
  apiClients: [
    { type: 'fetch' },
    { type: 'axios' },
  ],
};
