/**
 * Scan command - scan a directory for API calls
 */

import { config as loadEnv } from "dotenv";
import { ScanResult } from "@api-surface/types";
import { ApiScanner } from "@api-surface/core";
// @ts-ignore - loadConfig export exists but dist needs rebuild
import {
  loadConfig,
  writeResults,
  writeFunctionCodePerEndpoint,
  formatSummary,
  extractSystemParamsFromApiCalls,
} from "@api-surface/core";
import * as fs from "fs/promises";
import * as path from "path";
import { describeSystemParamsWithAi } from "./describe-system-params";
import {
  discoverApiDependenciesWithAi,
  resolveDiscoveredPath,
} from "./discover-api-dependencies";
import { handleActions } from "./actions";

export interface ScanOptions {
  root?: string;
  config?: string;
  framework?: string;
  output?: string;
  /** Write one JSON file per endpoint with function code(s) into this directory */
  functionCodeDir?: string;
  /** Directory to scan for API route handlers, relative to root (e.g. src/app/api). Overrides config. */
  apiRoutesDir?: string;
  /** After writing function code, generate action JSON files (requires ANTHROPIC_API_KEY or OPENAI_API_KEY). */
  generateActions?: boolean;
  /** Directory to write action JSON files when --generate-actions is set (default: actions). */
  actionsOutputDir?: string;
}

export async function handleScan(
  directory: string,
  options: ScanOptions,
): Promise<void> {
  try {
    // Resolve root directory
    const rootDir = options.root
      ? path.resolve(process.cwd(), options.root)
      : path.resolve(process.cwd(), directory);

    // Validate directory exists
    try {
      const stats = await fs.stat(rootDir);
      if (!stats.isDirectory()) {
        console.error(`Error: ${rootDir} is not a directory`);
        process.exit(1);
      }
    } catch (error) {
      console.error(`Error: Directory not found: ${rootDir}`);
      process.exit(1);
    }

    // Load config using the new config loader
    const config = await loadConfig({
      rootDir,
      configPath: options.config,
    });

    // Override framework if provided via CLI
    if (options.framework) {
      config.framework = options.framework as any;
    }

    // Override function code output dir if provided via CLI
    if (options.functionCodeDir !== undefined) {
      config.functionCodeOutputDir = options.functionCodeDir;
    }

    // Override API routes dir if provided via CLI (directory to scan for API route handlers)
    if (options.apiRoutesDir !== undefined) {
      config.apiRoutesDir = options.apiRoutesDir.trim() || undefined;
    }

    console.log(`Using config from: ${options.config || "defaults"}`);

    // When API routes dir is set, optionally use AI to discover more dependencies so we don't miss any
    if (config.apiRoutesDir?.trim()) {
      loadEnv();
      const anthropicKey = process.env.ANTHROPIC_API_KEY;
      const openaiKey = process.env.OPENAI_API_KEY;
      if (anthropicKey?.trim() || openaiKey?.trim()) {
        try {
          const discovered = await discoverApiDependenciesWithAi(
            rootDir,
            config.apiRoutesDir.trim(),
            { anthropicKey, openaiKey }
          );
          if (discovered.filePaths.length > 0) {
            const resolved: string[] = [];
            for (const rel of discovered.filePaths) {
              const abs = resolveDiscoveredPath(rel, rootDir);
              if (abs) resolved.push(abs);
            }
            if (resolved.length > 0) {
              config.additionalIncludeFiles = [
                ...(config.additionalIncludeFiles ?? []),
                ...resolved,
              ];
              console.log(
                `AI dependency discovery: ${discovered.filePaths.length} paths → ${resolved.length} resolved file(s) added to scan`
              );
            }
          }
        } catch (e) {
          console.warn(
            "AI dependency discovery failed:",
            e instanceof Error ? e.message : String(e)
          );
        }
      }
    }

    // Perform scan
    console.log(`Scanning ${rootDir}...`);
    const scanner = new ApiScanner(config);
    const result: ScanResult = await scanner.scan();

    // Extract required system params from function code and optionally add AI descriptions
    const systemParamsWithContext = extractSystemParamsFromApiCalls(
      result.apiCalls,
    );
    if (systemParamsWithContext.length > 0) {
      loadEnv();
      try {
        result.requiredSystemParams = await describeSystemParamsWithAi(
          systemParamsWithContext,
          {
            anthropicKey: process.env.ANTHROPIC_API_KEY,
            openaiKey: process.env.OPENAI_API_KEY,
          },
        );
        if (
          result.requiredSystemParams.some((p) => p.description) &&
          options.output
        ) {
          console.log(
            `\n✓ Described ${result.requiredSystemParams.filter((p) => p.description).length} system parameter(s) (AI).`,
          );
        }
      } catch (e) {
        // Fallback: include param names without descriptions
        result.requiredSystemParams = systemParamsWithContext.map((p) => ({
          name: p.name,
        }));
        if (options.output) {
          console.warn(
            `  ⚠ Could not get AI descriptions for system params: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      }
    }

    // Output results
    if (options.output) {
      // Write normalized JSON output
      const outputPath = path.resolve(process.cwd(), options.output);
      await writeResults(result, {
        outputPath,
        includeRaw: false,
        pretty: true,
      });

      // Display summary
      const summary = formatSummary(result);
      console.log(summary);
      console.log(`\n✓ Results saved to ${outputPath}`);
    } else {
      // Display summary only
      const summary = formatSummary(result);
      console.log(summary);
    }

    // If functionCodeOutputDir is set, write one JSON file per endpoint (API function only when apiRoutesDir is set)
    if (config.functionCodeOutputDir) {
      const functionCodeDir = path.resolve(
        process.cwd(),
        config.functionCodeOutputDir,
      );
      await writeFunctionCodePerEndpoint(result.apiCalls, functionCodeDir, {
        pretty: true,
        apiFunctionOnly: !!config.apiRoutesDir,
        apiRoutesDir: config.apiRoutesDir,
        rootDir: config.rootDir,
      });
      console.log(`\n✓ Function code per endpoint saved to ${functionCodeDir}`);

      // Optionally generate action JSON directly from the scan (includes inner routes)
      if (options.generateActions) {
        const actionsDir = path.resolve(
          process.cwd(),
          options.actionsOutputDir?.trim() || "actions",
        );
        await handleActions({
          inputDir: functionCodeDir,
          outputDir: actionsDir,
        });
        console.log(`\n✓ Action JSON saved to ${actionsDir}`);
      }
    }
  } catch (error) {
    console.error(
      "Error during scan:",
      error instanceof Error ? error.message : String(error),
    );
    process.exit(1);
  }
}
