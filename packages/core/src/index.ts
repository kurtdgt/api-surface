/**
 * Core scanner - framework-agnostic API call detection
 */

import { ScanConfig, ScanResult, ScanError } from '@api-surface/types';
import { scanFiles } from './scanner/file-scanner';
import { AstParser } from './ast/parser';
import { DetectorRegistry } from './detector/registry';
import { DetectorVisitor } from './detector/visitor';
import { FetchDetector } from './detector/fetch-detector';
import { AxiosDetector } from './detector/axios-detector';

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
    
    console.log(`Registered ${this.detectorRegistry.getCount()} built-in detector(s)`);
  }

  /**
   * Scan the repository for API calls
   */
  async scan(): Promise<ScanResult> {
    // Step 1: Scan files
    const fileScanResult = await scanFiles(this.config);
    
    console.log(`Found ${fileScanResult.count} files to scan`);

    // Step 2: Parse AST for each file and run detectors
    const errors: ScanError[] = [];
    let filesParsed = 0;
    const allApiCalls: ScanResult['apiCalls'] = [];

    for (const filePath of fileScanResult.files) {
      try {
        const context = this.astParser.parseFile(filePath);
        
        if (context) {
          // Step 3: Create detector visitor and traverse AST
          const detectorVisitor = new DetectorVisitor(this.detectorRegistry, this.config);
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
  registerDetector(detector: import('./detector/detector').Detector): void {
    this.detectorRegistry.register(detector);
  }
}

export * from '@api-surface/types';
export { loadConfig } from './config/loader';
export * from './config';
export * from './scanner';
export * from './ast';
export * from './detector';
export * from './output';
