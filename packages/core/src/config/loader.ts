/**
 * Configuration loader - supports both JSON and TypeScript config files
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { ScanConfig } from '@api-surface/types';
import { DEFAULT_CONFIG } from './defaults';
import { ConfigFileSchema } from './schema';

export interface LoadConfigOptions {
  rootDir: string;
  configPath?: string;
}

/**
 * Load configuration from file or use defaults
 */
export async function loadConfig(options: LoadConfigOptions): Promise<ScanConfig> {
  const { rootDir, configPath } = options;

  // If no config path provided, try to find default config file
  if (!configPath) {
    const defaultPath = await findDefaultConfig(rootDir);
    if (defaultPath) {
      return await loadConfigFromFile(defaultPath, rootDir);
    }
    return getDefaultConfig(rootDir);
  }

  // Load from provided path
  const resolvedPath = path.isAbsolute(configPath)
    ? configPath
    : path.resolve(rootDir, configPath);

  return await loadConfigFromFile(resolvedPath, rootDir);
}

/**
 * Find default config file in directory
 */
async function findDefaultConfig(rootDir: string): Promise<string | null> {
  const configNames = [
    'api-surface.config.ts',
    'api-surface.config.js',
    'api-surface.config.json',
    '.api-surface.json',
  ];

  for (const name of configNames) {
    const configPath = path.join(rootDir, name);
    try {
      await fs.access(configPath);
      return configPath;
    } catch {
      // File doesn't exist, try next
    }
  }

  return null;
}

/**
 * Load configuration from a specific file
 */
async function loadConfigFromFile(configPath: string, rootDir: string): Promise<ScanConfig> {
  try {
    const ext = path.extname(configPath).toLowerCase();
    let rawConfig: unknown;

    if (ext === '.json') {
      // Load JSON config
      const content = await fs.readFile(configPath, 'utf-8');
      rawConfig = JSON.parse(content);
    } else if (ext === '.ts' || ext === '.js') {
      // Load TypeScript/JavaScript config
      rawConfig = await loadTypeScriptConfig(configPath);
    } else {
      throw new Error(`Unsupported config file extension: ${ext}`);
    }

    // Validate and merge with defaults
    const validated = validateAndMerge(rawConfig, rootDir);
    return validated;
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to load config from ${configPath}: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Load TypeScript/JavaScript config file
 */
async function loadTypeScriptConfig(configPath: string): Promise<unknown> {
  try {
    // Use dynamic import to load the config file
    // This requires the file to be in a format that can be imported
    const configModule = await import(configPath);
    
    // Support both default export and named export
    return configModule.default || configModule;
  } catch (error) {
    // Fallback: try using tsx to execute the file
    // This is a workaround for TypeScript files that need compilation
    throw new Error(
      `Failed to load TypeScript config. Ensure the file exports a default config object. ` +
      `Error: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Validate configuration and merge with defaults
 */
function validateAndMerge(rawConfig: unknown, rootDir: string): ScanConfig {
  try {
    // Validate using config file schema (doesn't include rootDir)
    const validated = ConfigFileSchema.parse(rawConfig);
    
    // Merge with defaults
    const merged: ScanConfig = {
      ...DEFAULT_CONFIG,
      ...validated,
      // Merge arrays properly
      include: validated.include ?? DEFAULT_CONFIG.include,
      exclude: validated.exclude ?? DEFAULT_CONFIG.exclude,
      apiClients: validated.apiClients ?? DEFAULT_CONFIG.apiClients,
      // rootDir always comes from the function parameter, not config file
      rootDir,
    };

    return merged;
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

/**
 * Get default configuration
 */
function getDefaultConfig(rootDir: string): ScanConfig {
  return {
    rootDir,
    ...DEFAULT_CONFIG,
  } as ScanConfig;
}
