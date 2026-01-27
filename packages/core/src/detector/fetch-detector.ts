/**
 * Fetch API Call Detector
 * Detects fetch() calls and extracts method, URL, and confidence
 */

import { Node, SyntaxKind, CallExpression, StringLiteral, TemplateExpression, Identifier, ObjectLiteralExpression, PropertyAssignment } from 'ts-morph';
import { BaseDetector } from './detector';
import { AstContext } from '../ast/context';
import { ScanConfig, ApiCall } from '@api-surface/types';

export type Confidence = 'high' | 'medium' | 'low';

export interface FetchDetectionResult {
  method: string;
  url: string;
  confidence: Confidence;
}

/**
 * Detector for fetch() API calls
 */
export class FetchDetector extends BaseDetector {
  readonly id = 'fetch';
  readonly name = 'Fetch API Detector';

  /**
   * Only detect on CallExpression nodes
   */
  shouldDetect(node: Node): boolean {
    return node.getKind() === SyntaxKind.CallExpression;
  }

  /**
   * Detect fetch() API calls
   */
  detect(node: Node, context: AstContext, config: ScanConfig): ApiCall | null {
    if (!this.shouldDetect(node)) {
      return null;
    }

    const callExpr = node as CallExpression;
    
    // Check if this is a fetch() call
    if (!this.isFetchCall(callExpr, context)) {
      return null;
    }

    // Extract URL and method
    const detection = this.extractFetchDetails(callExpr, context);
    
    if (!detection) {
      return null;
    }

    // Log detection for validation
    this.logDetection(context, detection, callExpr);

    // Create ApiCall
    return this.createApiCall(
      detection.method,
      detection.url,
      'fetch',
      callExpr,
      context,
      detection.confidence
    );
  }

  /**
   * Check if this is a fetch() call
   */
  private isFetchCall(callExpr: CallExpression, context: AstContext): boolean {
    const expression = callExpr.getExpression();
    
    // Check if expression is an identifier named "fetch"
    if (expression.getKind() === SyntaxKind.Identifier) {
      const identifier = expression as Identifier;
      if (identifier.getText() === 'fetch') {
        return true;
      }
    }

    // Check if it's a property access like window.fetch or globalThis.fetch
    if (expression.getKind() === SyntaxKind.PropertyAccessExpression) {
      const propertyAccess = expression as any;
      const name = propertyAccess.getName();
      if (name === 'fetch') {
        return true;
      }
    }

    return false;
  }

  /**
   * Extract fetch details (method, URL, confidence)
   */
  private extractFetchDetails(
    callExpr: CallExpression,
    context: AstContext
  ): FetchDetectionResult | null {
    const arguments_ = callExpr.getArguments();
    
    if (arguments_.length === 0) {
      return null;
    }

    // Extract URL from first argument
    const urlArg = arguments_[0];
    const urlResult = this.extractUrl(urlArg, context);
    
    if (!urlResult) {
      return null;
    }

    // Extract method from second argument (options object)
    let method = 'GET'; // Default method
    if (arguments_.length > 1) {
      const optionsArg = arguments_[1];
      const extractedMethod = this.extractMethod(optionsArg);
      if (extractedMethod) {
        method = extractedMethod.toUpperCase();
      }
    }

    return {
      method,
      url: urlResult.url,
      confidence: urlResult.confidence,
    };
  }

  /**
   * Extract URL from node and determine confidence
   */
  private extractUrl(
    node: Node,
    context: AstContext
  ): { url: string; confidence: Confidence } | null {
    const kind = node.getKind();

    // High confidence: String literal
    if (kind === SyntaxKind.StringLiteral) {
      const stringLiteral = node as StringLiteral;
      const url = stringLiteral.getLiteralValue();
      // Accept any string as URL (could be relative path, variable, etc.)
      return { url, confidence: 'high' };
    }

    // Template literal handling
    if (kind === SyntaxKind.TemplateExpression) {
      // Has interpolations - medium confidence
      const template = node as TemplateExpression;
      const url = template.getText().replace(/^`|`$/g, '');
      return { url, confidence: 'medium' };
    }

    if (kind === SyntaxKind.NoSubstitutionTemplateLiteral) {
      // No interpolations - high confidence (static template string)
      const template = node as any;
      const url = template.getLiteralValue() || template.getText().replace(/^`|`$/g, '');
      return { url, confidence: 'high' };
    }

    // Low confidence: Identifier or other expressions
    if (kind === SyntaxKind.Identifier || kind === SyntaxKind.PropertyAccessExpression) {
      const text = node.getText();
      return { url: text, confidence: 'low' };
    }

    // Low confidence: Any other expression (computed, function call, etc.)
    const text = node.getText();
    return { url: text, confidence: 'low' };
  }

  /**
   * Extract HTTP method from options object
   */
  private extractMethod(node: Node): string | null {
    // Check if it's an object literal
    if (node.getKind() !== SyntaxKind.ObjectLiteralExpression) {
      return null;
    }

    const objectLiteral = node as ObjectLiteralExpression;
    const properties = objectLiteral.getProperties();

    for (const property of properties) {
      if (property.getKind() === SyntaxKind.PropertyAssignment) {
        const propAssignment = property as PropertyAssignment;
        const name = propAssignment.getName();
        
        if (name === 'method') {
          const initializer = propAssignment.getInitializer();
          if (initializer) {
            // Extract string value
            if (initializer.getKind() === SyntaxKind.StringLiteral) {
              return (initializer as StringLiteral).getLiteralValue();
            }
            // For other types, return the text
            return initializer.getText();
          }
        }
      }
    }

    return null;
  }

  /**
   * Log detection for validation
   */
  private logDetection(
    context: AstContext,
    detection: FetchDetectionResult,
    node: CallExpression
  ): void {
    const sourceFile = node.getSourceFile();
    const { line, column } = sourceFile.getLineAndColumnAtPos(node.getStart());
    const fileName = context.filePath.split('/').pop() || context.filePath;
    
    console.log(
      `[${this.name}] ${detection.method} ${detection.url} ` +
      `(${detection.confidence} confidence) ` +
      `at ${fileName}:${line}:${column}`
    );
  }
}
