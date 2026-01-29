/**
 * Function code extraction - static analysis only.
 * Locates the function/service that contains an API call and extracts its source code.
 * Runs as a separate phase after detection; does not modify detectors.
 *
 * Expected output shape (added to ApiCall):
 * - functionName?: string       e.g. "getUsers"
 * - functionFile?: string       e.g. "/project/src/api/users.ts"
 * - functionCode?: string | null  full source of the containing function
 * - functionResolutionConfidence?: "high" | "medium" | "low"
 *
 * Example (high confidence - direct containment):
 *   function getUsers() { return fetch('/api/users').then(r => r.json()); }
 *   -> functionCode: "function getUsers() { return fetch('/api/users').then(r => r.json()); }"
 *
 * Example (medium - resolved import): api.getUsers() where api is from '@/lib/api'
 *   -> functionCode from the getUsers method in the imported file.
 */

import {
  Project,
  SourceFile,
  Node,
  CallExpression,
  SyntaxKind,
  FunctionDeclaration,
  ArrowFunction,
  FunctionExpression,
  MethodDeclaration,
  VariableDeclaration,
  VariableDeclarationList,
  VariableStatement,
  Identifier,
  PropertyAccessExpression,
} from "ts-morph";
import * as path from "path";
import * as fs from "fs";
import { ApiCall, FunctionResolutionConfidence } from "@api-surface/types";
import { AstContext } from "../ast/context";

/** Default max lines to extract per function (safety limit; do not extract entire files). */
export const DEFAULT_MAX_FUNCTION_LINES = 300;

/** Result of extracting function code for a single ApiCall. */
export interface FunctionExtractionResult {
  functionName?: string;
  functionFile?: string;
  functionCode?: string | null;
  functionResolutionConfidence?: FunctionResolutionConfidence;
}

/**
 * Extracts the source code of the function that contains an API call.
 * When apiRoutesDir is set (e.g. "src/app/api"), prefers extracting the API route handler
 * for the called URL from that directory (Next.js App Router style), not the caller.
 */
export class FunctionExtractor {
  constructor(
    private project: Project,
    private rootDir: string,
    private maxFunctionLines: number = DEFAULT_MAX_FUNCTION_LINES,
    private apiRoutesDir?: string,
  ) {}

  /**
   * Extract function code for a single API call.
   * When apiRoutesDir is set, first tries to resolve the URL to a route file under apiRoutesDir
   * and extract the handler (GET/POST etc.); otherwise locates the caller in the AST.
   */
  extract(apiCall: ApiCall): FunctionExtractionResult {
    // When apiRoutesDir is set, prefer the API route handler in src/app/api (the "API function").
    if (this.apiRoutesDir) {
      const routeResult = this.tryResolveApiRouteHandler(apiCall);
      if (routeResult) {
        return routeResult;
      }
    }

    const sourceFile = this.getSourceFile(apiCall.file);
    if (!sourceFile) {
      return { functionResolutionConfidence: "low" };
    }

    const offset = this.getOffsetFromLineColumn(
      sourceFile.getFullText(),
      apiCall.line,
      apiCall.column,
    );
    if (offset === undefined) {
      return { functionResolutionConfidence: "low" };
    }

    const callExpr = this.findCallExpressionAtOffset(sourceFile, offset);
    if (!callExpr) {
      return { functionResolutionConfidence: "low" };
    }

    const context = new AstContext(sourceFile, apiCall.file, this.project);

    // First try: function directly contains the API call (high confidence).
    const direct = this.extractDirectContainingFunction(callExpr, context);
    if (direct) {
      return direct;
    }

    // Second try: call is on an imported object (e.g. api.getUsers()) - resolve implementation (medium).
    const resolved = this.tryResolveImportedCall(callExpr, context);
    if (resolved) {
      return resolved;
    }

    return { functionResolutionConfidence: "low" };
  }

  /**
   * Resolve the API call URL to a route file under apiRoutesDir (e.g. src/app/api)
   * and extract the handler for the request method (GET, POST, etc.).
   * Next.js App Router: /api/users -> src/app/api/users/route.ts with exported GET, POST, etc.
   */
  private tryResolveApiRouteHandler(
    apiCall: ApiCall,
  ): FunctionExtractionResult | null {
    const pathname = this.getPathnameFromUrl(apiCall.url);
    if (!pathname.startsWith("/api/")) {
      return null;
    }
    // Route path: /api/users -> "users", /api/users/[id] -> "users/[id]"
    const routePath =
      pathname.slice(4).replace(/^\//, "").replace(/\/$/, "") || "";
    if (!routePath) {
      return null;
    }

    const routeDir = path.join(this.rootDir, this.apiRoutesDir!, routePath);
    const routeFile = this.findRouteFile(routeDir);
    if (!routeFile) {
      return null;
    }

    const sourceFile = this.getSourceFile(routeFile);
    if (!sourceFile) {
      return null;
    }

    // Next.js App Router: route.ts exports GET, POST, PUT, PATCH, DELETE (named exports).
    const methodName = apiCall.method.toUpperCase();
    const handler = this.findExportedHandlerInRouteFile(sourceFile, methodName);
    if (!handler) {
      return null;
    }

    const code = this.getNodeTextWithLimit(handler.node);
    if (!code) {
      return null;
    }

    return {
      functionName: methodName,
      functionFile: routeFile,
      functionCode: code,
      functionResolutionConfidence: "high",
    };
  }

  /** Get pathname from URL (strip origin if full URL). */
  private getPathnameFromUrl(url: string): string {
    try {
      if (url.startsWith("http://") || url.startsWith("https://")) {
        const u = new URL(url);
        return u.pathname;
      }
    } catch {
      // ignore
    }
    return url.split("?")[0] || url;
  }

  /** Find route.ts, route.tsx, or route.js in directory. */
  private findRouteFile(routeDir: string): string | null {
    const names = ["route.ts", "route.tsx", "route.js"];
    for (const name of names) {
      const filePath = path.join(routeDir, name);
      if (fs.existsSync(filePath)) {
        return filePath;
      }
    }
    return null;
  }

  /**
   * Find exported handler (GET, POST, etc.) in a route file.
   * Supports: export async function GET(...), export function GET(...), export const GET = ...
   */
  private findExportedHandlerInRouteFile(
    sourceFile: SourceFile,
    methodName: string,
  ): { name: string; node: Node } | null {
    // FunctionDeclaration with name GET/POST etc. (exported)
    const fnDecls = sourceFile.getDescendantsOfKind(
      SyntaxKind.FunctionDeclaration,
    );
    for (const fn of fnDecls) {
      if (fn.getName() === methodName && this.isExported(fn)) {
        return { name: methodName, node: fn };
      }
    }

    // VariableStatement: export const GET = async () => ...
    const varStmts = sourceFile.getDescendantsOfKind(
      SyntaxKind.VariableStatement,
    );
    for (const stmt of varStmts) {
      if (!this.isExported(stmt)) continue;
      const declList = stmt.getDeclarationList();
      const decls = declList.getDeclarations();
      for (const decl of decls) {
        const nameNode = decl.getNameNode();
        if (
          nameNode.getKind() === SyntaxKind.Identifier &&
          (nameNode as Identifier).getText() === methodName
        ) {
          return { name: methodName, node: stmt };
        }
      }
    }

    return null;
  }

  /** Check if node has export modifier (ts-morph exportable nodes). */
  private isExported(node: Node): boolean {
    const n = node as Node & { isExported?: () => boolean };
    if (typeof n.isExported === "function") {
      return n.isExported();
    }
    const modifiers =
      (node as Node & { getModifiers?: () => Node[] }).getModifiers?.() ?? [];
    return modifiers.some((m: Node) => m.getText() === "export");
  }

  /**
   * Get source file by path. Prefer project file; add if not present.
   */
  private getSourceFile(filePath: string): SourceFile | null {
    const absolutePath = path.isAbsolute(filePath)
      ? filePath
      : path.resolve(this.rootDir, filePath);
    let sourceFile = this.project.getSourceFile(absolutePath);
    if (!sourceFile) {
      try {
        sourceFile = this.project.addSourceFileAtPath(absolutePath);
      } catch {
        return null;
      }
    }
    return sourceFile ?? null;
  }

  /**
   * Convert 1-based line and column to character offset.
   * ts-morph uses 1-based line/column from getLineAndColumnAtPos.
   */
  private getOffsetFromLineColumn(
    text: string,
    line: number,
    column: number,
  ): number | undefined {
    const lines = text.split(/\r?\n/);
    if (line < 1 || line > lines.length) return undefined;
    const lineIndex = line - 1;
    const lineText = lines[lineIndex];
    if (column < 1 || column > lineText.length + 1) return undefined;
    let offset = 0;
    for (let i = 0; i < lineIndex; i++) {
      offset += lines[i].length + 1; // +1 for newline
    }
    return offset + (column - 1);
  }

  /**
   * Find the CallExpression node that starts at the given offset.
   * We want the call the detector ran on (exact position match).
   */
  private findCallExpressionAtOffset(
    sourceFile: SourceFile,
    offset: number,
  ): CallExpression | null {
    const callExpressions = sourceFile.getDescendantsOfKind(
      SyntaxKind.CallExpression,
    );
    for (const call of callExpressions) {
      if (call.getStart() === offset) {
        return call;
      }
    }
    return null;
  }

  /**
   * Walk upward from the CallExpression to find the nearest callable scope and extract it.
   * - FunctionDeclaration: named function
   * - ArrowFunction / FunctionExpression: may be inside VariableDeclaration -> use full VariableStatement
   * - MethodDeclaration: class method
   * High confidence: we are inside the same file and the call is directly in this scope.
   */
  private extractDirectContainingFunction(
    callExpr: CallExpression,
    context: AstContext,
  ): FunctionExtractionResult | null {
    let node: Node | undefined = callExpr;

    while (node) {
      const kind = node.getKind();

      // Named function declaration: function foo() { ... }
      if (kind === SyntaxKind.FunctionDeclaration) {
        const fn = node as FunctionDeclaration;
        const name = fn.getName();
        const code = this.getNodeTextWithLimit(fn);
        if (code === null) return null;
        return {
          functionName: name ?? undefined,
          functionFile: context.filePath,
          functionCode: code,
          functionResolutionConfidence: "high",
        };
      }

      // Class method: class C { method() { ... } }
      if (kind === SyntaxKind.MethodDeclaration) {
        const method = node as MethodDeclaration;
        const name = method.getName();
        const code = this.getNodeTextWithLimit(method);
        if (code === null) return null;
        return {
          functionName: typeof name === "string" ? name : undefined,
          functionFile: context.filePath,
          functionCode: code,
          functionResolutionConfidence: "high",
        };
      }

      // Arrow function or function expression: may be in a variable declaration.
      // Prefer extracting the full variable statement (e.g. "const fn = () => ...") for clarity.
      if (
        kind === SyntaxKind.ArrowFunction ||
        kind === SyntaxKind.FunctionExpression
      ) {
        const parent = node.getParent();
        if (parent && parent.getKind() === SyntaxKind.VariableDeclaration) {
          const varDecl = parent as VariableDeclaration;
          // VariableDeclaration -> VariableDeclarationList -> VariableStatement (not CatchClause)
          const list = varDecl.getParent();
          if (list?.getKind() === SyntaxKind.VariableDeclarationList) {
            const stmt = (list as VariableDeclarationList).getParent();
            if (stmt && stmt.getKind() === SyntaxKind.VariableStatement) {
              const varStmt = stmt as VariableStatement;
              const code = this.getNodeTextWithLimit(varStmt);
              if (code === null) return null;
              const nameNode = varDecl.getNameNode();
              const name =
                nameNode.getKind() === SyntaxKind.Identifier
                  ? (nameNode as Identifier).getText()
                  : undefined;
              return {
                functionName: name,
                functionFile: context.filePath,
                functionCode: code,
                functionResolutionConfidence: "high",
              };
            }
          }
        }
        // Standalone arrow/function expression (e.g. IIFE or callback).
        const code = this.getNodeTextWithLimit(node);
        if (code === null) return null;
        return {
          functionFile: context.filePath,
          functionCode: code,
          functionResolutionConfidence: "high",
        };
      }

      node = node.getParent();
    }

    return null;
  }

  /**
   * If the API call is on an imported object (e.g. api.getUsers()), try to resolve
   * the implementation in the imported file. Medium confidence.
   */
  private tryResolveImportedCall(
    callExpr: CallExpression,
    context: AstContext,
  ): FunctionExtractionResult | null {
    const expression = callExpr.getExpression();
    if (expression.getKind() !== SyntaxKind.PropertyAccessExpression) {
      return null;
    }
    const propAccess = expression as PropertyAccessExpression;
    const methodName = propAccess.getName();
    const objectExpr = propAccess.getExpression();
    if (objectExpr.getKind() !== SyntaxKind.Identifier) {
      return null;
    }
    const objectName = (objectExpr as Identifier).getText();

    // Find which module this identifier is imported from.
    const imports = context.getImports();
    for (const imp of imports) {
      if (imp.isTypeOnly) continue;
      const isDefault = imp.defaultImport === objectName;
      const isNamed = imp.namedImports.includes(objectName);
      if (!isDefault && !isNamed) continue;

      const moduleSpecifier = imp.moduleSpecifier;
      const resolvedPath = context.resolveImportPath(moduleSpecifier);
      if (!resolvedPath) continue;

      // Only resolve within project; ignore node_modules.
      const normalizedResolved = path.normalize(resolvedPath);
      const normalizedRoot = path.normalize(this.rootDir);
      if (
        !normalizedResolved.startsWith(normalizedRoot) ||
        normalizedResolved.includes("node_modules")
      ) {
        continue;
      }

      const targetFile = this.getSourceFile(resolvedPath);
      if (!targetFile) continue;

      // Look for the method: default export object with method, or named export function.
      const targetContext = new AstContext(
        targetFile,
        resolvedPath,
        this.project,
      );
      const extracted = this.findMethodInFile(
        targetFile,
        targetContext,
        methodName,
        isDefault,
      );
      if (extracted) {
        return {
          functionName: extracted.name,
          functionFile: resolvedPath,
          functionCode: extracted.code,
          functionResolutionConfidence: "medium",
        };
      }
    }
    return null;
  }

  /**
   * Find a method or function named methodName in the file.
   * - If isDefault: look for export default { methodName() { ... } } or class with methodName.
   * - If named: look for exported function or const methodName = ...
   */
  private findMethodInFile(
    sourceFile: SourceFile,
    context: AstContext,
    methodName: string,
    isDefaultExport: boolean,
  ): { name: string; code: string } | null {
    // Class with method: class X { methodName() { ... } }
    const classes = sourceFile.getDescendantsOfKind(
      SyntaxKind.ClassDeclaration,
    );
    for (const cls of classes) {
      const method = cls.getMethod(methodName);
      if (method) {
        const code = this.getNodeTextWithLimit(method);
        if (code) return { name: methodName, code };
      }
    }

    // Function declaration: function methodName() { ... }
    const fnDecls = sourceFile.getDescendantsOfKind(
      SyntaxKind.FunctionDeclaration,
    );
    for (const fn of fnDecls) {
      if (fn.getName() === methodName) {
        const code = this.getNodeTextWithLimit(fn);
        if (code) return { name: methodName, code };
      }
    }

    // Variable with arrow/function: const methodName = () => ... or function() { ... }
    const varStmts = sourceFile.getDescendantsOfKind(
      SyntaxKind.VariableStatement,
    );
    for (const stmt of varStmts) {
      const declList = stmt.getDeclarationList();
      const decls = declList.getDeclarations();
      for (const decl of decls) {
        const nameNode = decl.getNameNode();
        if (
          nameNode.getKind() === SyntaxKind.Identifier &&
          (nameNode as Identifier).getText() === methodName
        ) {
          const code = this.getNodeTextWithLimit(stmt);
          if (code) return { name: methodName, code };
        }
      }
    }

    return null;
  }

  /**
   * Get node text with line limit and trim. No minification; strip leading/trailing whitespace only.
   */
  private getNodeTextWithLimit(node: Node): string | null {
    const fullText = node.getText();
    const lines = fullText.split(/\r?\n/);
    if (lines.length > this.maxFunctionLines) {
      // Truncate and add a comment so caller knows it was limited.
      const truncated = lines.slice(0, this.maxFunctionLines).join("\n");
      const trimmed = truncated.trim();
      return trimmed
        ? `${trimmed}\n\n/* ... truncated (max ${this.maxFunctionLines} lines) */`
        : null;
    }
    return fullText.trim();
  }
}

/**
 * Run the extraction phase on a list of API calls.
 * Mutates each ApiCall with functionName, functionFile, functionCode, functionResolutionConfidence.
 * When apiRoutesDir is set (e.g. "src/app/api"), functionCode is taken from the route handler for the URL.
 */
export function extractFunctionCodeForApiCalls(
  apiCalls: ApiCall[],
  project: Project,
  rootDir: string,
  maxFunctionLines: number = DEFAULT_MAX_FUNCTION_LINES,
  apiRoutesDir?: string,
): void {
  const extractor = new FunctionExtractor(
    project,
    rootDir,
    maxFunctionLines,
    apiRoutesDir,
  );
  for (const call of apiCalls) {
    const result = extractor.extract(call);
    if (result.functionName !== undefined)
      call.functionName = result.functionName;
    if (result.functionFile !== undefined)
      call.functionFile = result.functionFile;
    if (result.functionCode !== undefined)
      call.functionCode = result.functionCode;
    if (result.functionResolutionConfidence !== undefined) {
      call.functionResolutionConfidence = result.functionResolutionConfidence;
    }
  }
}
