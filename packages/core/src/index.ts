/**
 * Core scanner - framework-agnostic API call detection
 */

import { ScanConfig, ScanResult, ScanError } from "@api-surface/types";
import { scanFiles } from "./scanner/file-scanner";
import { getApiDirFilesWithRelated } from "./scanner/api-dir-resolver";
import { AstParser } from "./ast/parser";
import { DetectorRegistry } from "./detector/registry";
import { DetectorVisitor } from "./detector/visitor";
import { FetchDetector } from "./detector/fetch-detector";
import { AxiosDetector } from "./detector/axios-detector";
import {
  extractFunctionCodeForApiCalls,
  discoverAllRouteHandlers,
  discoveredHandlersToApiCalls,
  DEFAULT_MAX_FUNCTION_LINES,
} from "./extraction";

export class ApiScanner {
  private astParser: AstParser;
  private detectorRegistry: DetectorRegistry;

  constructor(private config: ScanConfig) {
    // Initialize AST parser
    this.astParser = new AstParser({
      rootDir: config.rootDir,
    });

    // Initialize detector registry
    this.detectorRegistry = new DetectorRegistry();

    // Register built-in detectors
    this.registerBuiltInDetectors();
  }

  /**
   * Register built-in detectors
   */
  private registerBuiltInDetectors(): void {
    // Register fetch detector
    const fetchDetector = new FetchDetector();
    this.detectorRegistry.register(fetchDetector);

    // Register axios detector
    const axiosDetector = new AxiosDetector();
    this.detectorRegistry.register(axiosDetector);

    console.log(
      `Registered ${this.detectorRegistry.getCount()} built-in detector(s)`,
    );
  }

  /**
   * Scan the repository for API calls
   */
  async scan(): Promise<ScanResult> {
    // Step 1: Scan files
    let fileScanResult = await scanFiles(this.config);

    // When API routes dir is set, ensure we include all files in that dir and their related imports
    if (this.config.apiRoutesDir?.trim()) {
      try {
        const resolved = await getApiDirFilesWithRelated(
          this.config.rootDir,
          this.config.apiRoutesDir.trim(),
          this.astParser
        );
        if (resolved.allFiles.length > 0) {
          const merged = [...new Set([...fileScanResult.files, ...resolved.allFiles])].sort();
          fileScanResult = { files: merged, count: merged.length };
          console.log(
            `API dir ${this.config.apiRoutesDir}: ${resolved.apiDirFiles.length} files, ${resolved.relatedFiles.length} related → ${merged.length} total files to scan`
          );
        }
      } catch (err) {
        console.warn(
          "Could not resolve API dir related files:",
          err instanceof Error ? err.message : String(err)
        );
      }
    }

    // Merge any additional files (e.g. from AI dependency discovery)
    if (this.config.additionalIncludeFiles?.length) {
      const merged = [...new Set([...fileScanResult.files, ...this.config.additionalIncludeFiles])].sort();
      fileScanResult = { files: merged, count: merged.length };
      console.log(`Included ${this.config.additionalIncludeFiles.length} additional file(s) from dependency discovery`);
    }

    console.log(`Found ${fileScanResult.count} files to scan`);

    // Step 2: Parse AST for each file and run detectors
    const errors: ScanError[] = [];
    let filesParsed = 0;
    const allApiCalls: ScanResult["apiCalls"] = [];

    for (const filePath of fileScanResult.files) {
      try {
        const context = this.astParser.parseFile(filePath);

        if (context) {
          // Step 3: Create detector visitor and traverse AST
          const detectorVisitor = new DetectorVisitor(
            this.detectorRegistry,
            this.config,
          );
          detectorVisitor.traverse(context);

          // Step 4: Collect API calls from detectors
          const apiCalls = detectorVisitor.getApiCalls();
          allApiCalls.push(...apiCalls);

          filesParsed++;
        }
      } catch (error) {
        errors.push({
          file: filePath,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    console.log(`Parsed ${filesParsed} files successfully`);
    console.log(`Detected ${allApiCalls.length} API calls`);

    // Step 5: Extraction phase - when apiRoutesDir is set, extract API route handlers from e.g. src/app/api
    const maxLines = this.config.maxFunctionLines ?? DEFAULT_MAX_FUNCTION_LINES;
    extractFunctionCodeForApiCalls(
      allApiCalls,
      this.astParser.getProject(),
      this.config.rootDir,
      maxLines,
      this.config.apiRoutesDir,
    );

    // Step 6: When apiRoutesDir is set, discover all nested route files (inner route.ts) and add any handlers not already present
    if (this.config.apiRoutesDir?.trim()) {
      try {
        const discovered = await discoverAllRouteHandlers(
          this.astParser.getProject(),
          this.config.rootDir,
          this.config.apiRoutesDir.trim(),
          maxLines
        );
        const existingKeys = new Set(
          allApiCalls.map((c) => `${c.method.toUpperCase()}:${c.url}`)
        );
        const newCalls = discoveredHandlersToApiCalls(discovered).filter(
          (c) => !existingKeys.has(`${c.method.toUpperCase()}:${c.url}`)
        );
        if (newCalls.length > 0) {
          allApiCalls.push(...newCalls);
          console.log(
            `Discovered ${newCalls.length} inner route handler(s) from nested route files`
          );
        }
      } catch (err) {
        console.warn(
          "Route discovery failed:",
          err instanceof Error ? err.message : String(err)
        );
      }
    }

    return {
      apiCalls: allApiCalls,
      filesScanned: filesParsed,
      errors,
    };
  }

  /**
   * Get the AST parser instance (for advanced usage)
   */
  getAstParser(): AstParser {
    return this.astParser;
  }

  /**
   * Get the detector registry (for registering detectors)
   */
  getDetectorRegistry(): DetectorRegistry {
    return this.detectorRegistry;
  }

  /**
   * Register a detector
   */
  registerDetector(detector: import("./detector/detector").Detector): void {
    this.detectorRegistry.register(detector);
  }
}

export * from "@api-surface/types";
export { loadConfig } from "./config/loader";
export * from "./config";
export type {
  ConfigFileInput,
  ConfigInput,
  ApiClientConfigInput,
} from "./config/schema";
export * from "./scanner";
export { getFilesInApiDir } from "./scanner/api-dir-resolver";
export * from "./ast";
export * from "./detector";
export * from "./output";
export * from "./extraction";
