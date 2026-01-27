/**
 * Detector Visitor - runs detectors on AST nodes during traversal
 */

import { Node } from 'ts-morph';
import { AstContext } from '../ast/context';
import { BaseAstVisitor } from '../ast/visitor';
import { DetectorRegistry } from './registry';
import { ScanConfig, ApiCall } from '@api-surface/types';

/**
 * Visitor that runs detectors on AST nodes
 */
export class DetectorVisitor extends BaseAstVisitor {
  private apiCalls: ApiCall[] = [];

  constructor(
    private registry: DetectorRegistry,
    private config: ScanConfig
  ) {
    super();
  }

  /**
   * Visit a node and run all enabled detectors
   */
  visit(node: Node, context: AstContext): boolean | void {
    // Get enabled detectors filtered by config
    const detectors = this.registry.filterByConfig(this.config);

    // Run each detector on this node
    for (const detector of detectors) {
      // Check if detector should run on this node type
      if (detector.shouldDetect && !detector.shouldDetect(node)) {
        continue;
      }

      try {
        const apiCall = detector.detect(node, context, this.config);
        
        if (apiCall) {
          this.apiCalls.push(apiCall);
        }
      } catch (error) {
        // Log error but continue with other detectors
        console.warn(
          `Detector "${detector.name}" (${detector.id}) failed on node:`,
          error instanceof Error ? error.message : String(error)
        );
      }
    }

    // Continue traversal
    return true;
  }

  /**
   * Get all detected API calls
   */
  getApiCalls(): ApiCall[] {
    return [...this.apiCalls];
  }

  /**
   * Clear detected API calls
   */
  clear(): void {
    this.apiCalls = [];
  }

  /**
   * Get count of detected API calls
   */
  getCount(): number {
    return this.apiCalls.length;
  }
}
