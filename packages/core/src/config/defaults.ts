/**
 * Default configuration values
 */

import { ScanConfig } from "@api-surface/types";

export const DEFAULT_CONFIG: Partial<ScanConfig> = {
  include: ["**/*.{js,jsx,ts,tsx}"],
  exclude: [
    "**/node_modules/**",
    "**/dist/**",
    "**/build/**",
    "**/.next/**",
    "**/coverage/**",
    "**/*.test.{js,jsx,ts,tsx}",
    "**/*.spec.{js,jsx,ts,tsx}",
    // React Native
    "**/android/**",
    "**/ios/**",
    "**/.expo/**",
    "**/__mocks__/**",
    "**/metro.config.*",
    "**/babel.config.*",
  ],
  framework: "generic",
  apiClients: [{ type: "fetch" }, { type: "axios" }],
  /** Default max lines to extract per function (safety limit) */
  maxFunctionLines: 300,
  /** Default directory for Next.js App Router API routes; when set, functionCode is the route handler, not the caller */
  apiRoutesDir: "src/app/api",
};
