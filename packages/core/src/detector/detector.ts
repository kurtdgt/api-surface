/**
 * Detector interface and types
 */

import { Node } from 'ts-morph';
import { AstContext } from '../ast/context';
import { ScanConfig, ApiCall } from '@api-surface/types';

/**
 * Detector interface - plugins that detect API calls in AST nodes
 */
export interface Detector {
  /**
   * Unique identifier for this detector
   */
  readonly id: string;

  /**
   * Human-readable name for this detector
   */
  readonly name: string;

  /**
   * Detect API calls in an AST node
   * 
   * @param node - The AST node to analyze
   * @param context - The AST context for the current file
   * @param config - The scan configuration
   * @returns ApiCall object if detected, null otherwise
   */
  detect(node: Node, context: AstContext, config: ScanConfig): ApiCall | null;

  /**
   * Optional: Check if this detector should run on this node type
   * If not implemented, detector will be called on all nodes
   * 
   * @param node - The AST node to check
   * @returns true if detector should run, false otherwise
   */
  shouldDetect?(node: Node): boolean;
}

/**
 * Base detector class with helper methods
 */
export abstract class BaseDetector implements Detector {
  abstract readonly id: string;
  abstract readonly name: string;

  abstract detect(node: Node, context: AstContext, config: ScanConfig): ApiCall | null;

  /**
   * Create an ApiCall object with position information
   */
  protected createApiCall(
    method: string,
    url: string,
    source: ApiCall['source'],
    node: Node,
    context: AstContext,
    confidence?: ApiCall['confidence']
  ): ApiCall {
    const { line, column } = node.getStartLineAndColumn();
    
    return {
      method,
      url,
      line,
      column,
      file: context.filePath,
      source,
      confidence,
    };
  }

  /**
   * Get node position
   */
  protected getNodePosition(node: Node): { line: number; column: number } {
    return node.getStartLineAndColumn();
  }

  /**
   * Get node text
   */
  protected getNodeText(node: Node): string {
    return node.getText();
  }

  /**
   * Check if a string looks like a URL
   */
  protected isUrlLike(str: string): boolean {
    return /^(https?|ftp|ws|wss):\/\//i.test(str) || 
           /^\/[^\/]/.test(str) || // Absolute path
           /^\.\.?\//.test(str);   // Relative path
  }
}
