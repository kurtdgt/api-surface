/**
 * Configuration schema using Zod
 */

import { z } from "zod";

export const ApiClientConfigSchema = z.object({
  type: z.enum(["fetch", "axios", "custom"]),
  name: z.string().optional(),
  patterns: z.array(z.string()).optional(),
});

// Schema for config file (rootDir is not in config files, it's set by CLI)
export const ConfigFileSchema = z.object({
  include: z.array(z.string()).optional(),
  exclude: z.array(z.string()).optional(),
  framework: z
    .enum(["none", "nextjs", "next", "react", "react-native", "generic"])
    .optional(),
  apiClients: z.array(ApiClientConfigSchema).optional(),
});

// Full schema for final ScanConfig (includes rootDir)
export const ScanConfigSchema = ConfigFileSchema.extend({
  rootDir: z.string().min(1, "rootDir must be a non-empty string"),
});

export type ConfigInput = z.infer<typeof ScanConfigSchema>;
export type ConfigFileInput = z.infer<typeof ConfigFileSchema>;
export type ApiClientConfigInput = z.infer<typeof ApiClientConfigSchema>;
