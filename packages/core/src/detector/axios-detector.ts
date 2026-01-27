/**
 * Axios API Call Detector
 * Detects axios.get(), axios.post(), axios.request() calls and extracts method, URL, and confidence
 */

import {
  Node,
  SyntaxKind,
  CallExpression,
  StringLiteral,
  TemplateExpression,
  Identifier,
  ObjectLiteralExpression,
  PropertyAssignment,
  PropertyAccessExpression,
} from 'ts-morph';
import { BaseDetector } from './detector';
import { AstContext } from '../ast/context';
import { ScanConfig, ApiCall } from '@api-surface/types';

type Confidence = 'high' | 'medium' | 'low';

export interface AxiosDetectionResult {
  method: string;
  url: string;
  confidence: Confidence;
}

/**
 * HTTP methods supported by axios
 */
const AXIOS_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'request'];

/**
 * Detector for axios API calls
 */
export class AxiosDetector extends BaseDetector {
  readonly id = 'axios';
  readonly name = 'Axios API Detector';

  // Cache for axios import info per file
  private axiosImportCache = new Map<string, {
    hasDefaultImport: boolean;
    hasNamedImports: Set<string>;
    defaultImportName?: string;
  }>();

  /**
   * Only detect on CallExpression nodes
   */
  shouldDetect(node: Node): boolean {
    return node.getKind() === SyntaxKind.CallExpression;
  }

  /**
   * Detect axios API calls
   */
  detect(node: Node, context: AstContext, config: ScanConfig): ApiCall | null {
    if (!this.shouldDetect(node)) {
      return null;
    }

    const callExpr = node as CallExpression;

    // Check if axios is imported in this file
    if (!this.isAxiosImported(context)) {
      return null;
    }

    // Check if this is an axios call
    const axiosInfo = this.getAxiosCallInfo(callExpr, context);
    if (!axiosInfo) {
      return null;
    }

    // Extract URL and method
    const detection = this.extractAxiosDetails(callExpr, axiosInfo, context);

    if (!detection) {
      return null;
    }

    // Log detection for validation
    this.logDetection(context, detection, callExpr);

    // Create ApiCall
    return this.createApiCall(
      detection.method,
      detection.url,
      'axios',
      callExpr,
      context,
      detection.confidence
    );
  }

  /**
   * Check if axios is imported in the file
   */
  private isAxiosImported(context: AstContext): boolean {
    const cacheKey = context.filePath;
    
    // Check cache first
    if (this.axiosImportCache.has(cacheKey)) {
      const cached = this.axiosImportCache.get(cacheKey)!;
      return cached.hasDefaultImport || cached.hasNamedImports.size > 0;
    }

    // Analyze imports
    const imports = context.getImports();
    const axiosImports = {
      hasDefaultImport: false,
      hasNamedImports: new Set<string>(),
      defaultImportName: undefined as string | undefined,
    };

    for (const imp of imports) {
      // Check if axios module is imported
      if (imp.moduleSpecifier === 'axios' || imp.moduleSpecifier.endsWith('/axios')) {
        // Default import: import axios from 'axios'
        if (imp.defaultImport) {
          axiosImports.hasDefaultImport = true;
          axiosImports.defaultImportName = imp.defaultImport;
        }

        // Named imports: import { get, post } from 'axios'
        for (const namedImport of imp.namedImports) {
          if (AXIOS_METHODS.includes(namedImport.toLowerCase())) {
            axiosImports.hasNamedImports.add(namedImport);
          }
        }
      }
    }

    // Cache the result
    this.axiosImportCache.set(cacheKey, axiosImports);

    return axiosImports.hasDefaultImport || axiosImports.hasNamedImports.size > 0;
  }

  /**
   * Get information about an axios call
   * Returns method name and call type
   */
  private getAxiosCallInfo(
    callExpr: CallExpression,
    context: AstContext
  ): { method: string; callType: 'method' | 'request' } | null {
    const expression = callExpr.getExpression();
    const cacheKey = context.filePath;
    const axiosImports = this.axiosImportCache.get(cacheKey)!;

    // Case 1: axios.get(), axios.post(), etc. (property access)
    if (expression.getKind() === SyntaxKind.PropertyAccessExpression) {
      const propAccess = expression as PropertyAccessExpression;
      const methodName = propAccess.getName().toLowerCase();
      const objectExpr = propAccess.getExpression();

      // Check if it's axios.methodName()
      if (objectExpr.getKind() === SyntaxKind.Identifier) {
        const identifier = objectExpr as Identifier;
        const objectName = identifier.getText();

        // Check if object name matches default import
        if (axiosImports.hasDefaultImport && 
            (objectName === axiosImports.defaultImportName || objectName === 'axios')) {
          if (AXIOS_METHODS.includes(methodName)) {
            return {
              method: methodName === 'request' ? 'request' : methodName.toUpperCase(),
              callType: methodName === 'request' ? 'request' : 'method',
            };
          }
        }
      }
    }

    // Case 2: get(), post(), etc. (direct named import call)
    if (expression.getKind() === SyntaxKind.Identifier) {
      const identifier = expression as Identifier;
      const methodName = identifier.getText().toLowerCase();

      if (axiosImports.hasNamedImports.has(identifier.getText()) &&
          AXIOS_METHODS.includes(methodName)) {
        return {
          method: methodName === 'request' ? 'request' : methodName.toUpperCase(),
          callType: methodName === 'request' ? 'request' : 'method',
        };
      }
    }

    return null;
  }

  /**
   * Extract axios details (method, URL, confidence)
   */
  private extractAxiosDetails(
    callExpr: CallExpression,
    axiosInfo: { method: string; callType: 'method' | 'request' },
    context: AstContext
  ): AxiosDetectionResult | null {
    const arguments_ = callExpr.getArguments();

    if (axiosInfo.callType === 'request') {
      // axios.request({ url, method }) or request({ url, method })
      return this.extractFromRequestCall(arguments_, context);
    } else {
      // axios.get(url) or get(url)
      return this.extractFromMethodCall(arguments_, axiosInfo.method, context);
    }
  }

  /**
   * Extract from method call: axios.get(url) or get(url)
   */
  private extractFromMethodCall(
    arguments_: Node[],
    method: string,
    context: AstContext
  ): AxiosDetectionResult | null {
    if (arguments_.length === 0) {
      return null;
    }

    // First argument is the URL
    const urlArg = arguments_[0];
    const urlResult = this.extractUrl(urlArg, context);

    if (!urlResult) {
      return null;
    }

    return {
      method: method.toUpperCase(),
      url: urlResult.url,
      confidence: urlResult.confidence,
    };
  }

  /**
   * Extract from request call: axios.request({ url, method })
   */
  private extractFromRequestCall(
    arguments_: Node[],
    context: AstContext
  ): AxiosDetectionResult | null {
    if (arguments_.length === 0) {
      return null;
    }

    const configArg = arguments_[0];

    // Must be an object literal
    if (configArg.getKind() !== SyntaxKind.ObjectLiteralExpression) {
      return null;
    }

    const objectLiteral = configArg as ObjectLiteralExpression;
    const properties = objectLiteral.getProperties();

    let url: string | null = null;
    let urlConfidence: Confidence = 'low';
    let method = 'GET'; // Default method

    for (const property of properties) {
      if (property.getKind() === SyntaxKind.PropertyAssignment) {
        const propAssignment = property as PropertyAssignment;
        const name = propAssignment.getName();
        const initializer = propAssignment.getInitializer();

        if (!initializer) {
          continue;
        }

        if (name === 'url') {
          const urlResult = this.extractUrl(initializer, context);
          if (urlResult) {
            url = urlResult.url;
            urlConfidence = urlResult.confidence;
          }
        } else if (name === 'method') {
          if (initializer.getKind() === SyntaxKind.StringLiteral) {
            method = (initializer as StringLiteral).getLiteralValue().toUpperCase();
          } else {
            method = initializer.getText().toUpperCase();
          }
        }
      }
    }

    if (!url) {
      return null;
    }

    return {
      method,
      url,
      confidence: urlConfidence,
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
   * Log detection for validation
   */
  private logDetection(
    context: AstContext,
    detection: AxiosDetectionResult,
    node: CallExpression
  ): void {
    const { line, column } = node.getStartLineAndColumn();
    const fileName = context.filePath.split('/').pop() || context.filePath;

    console.log(
      `[${this.name}] ${detection.method} ${detection.url} ` +
      `(${detection.confidence} confidence) ` +
      `at ${fileName}:${line}:${column}`
    );
  }

  /**
   * Clear import cache (useful for testing or when file changes)
   */
  clearCache(): void {
    this.axiosImportCache.clear();
  }
}
