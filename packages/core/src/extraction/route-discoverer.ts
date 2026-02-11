/**
 * Discover all nested route files (route.ts, route.tsx, route.js) under apiRoutesDir
 * and extract each exported HTTP method handler (GET, POST, etc.) so inner routes
 * are included in the scan and can generate action JSON.
 */

import fg from "fast-glob";
import * as fs from "fs";
import * as path from "path";
import {
  Project,
  SourceFile,
  Node,
  SyntaxKind,
  Identifier,
} from "ts-morph";
import type { ApiCall } from "@api-surface/types";
import { DEFAULT_MAX_FUNCTION_LINES } from "./function-extractor";

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];
const ROUTE_FILENAMES = ["route.ts", "route.tsx", "route.js"];

export interface DiscoveredRouteHandler {
  method: string;
  url: string;
  functionFile: string;
  functionName: string;
  functionCode: string | null;
}

/**
 * Find all route files under apiRoutesDir (any nesting level).
 * e.g. src/app/api -> .../api/commercial-buildings/risk-areas/route.ts
 */
export async function findAllRouteFiles(
  rootDir: string,
  apiRoutesDir: string
): Promise<string[]> {
  const apiDirAbs = path.resolve(rootDir, apiRoutesDir);
  if (!fs.existsSync(apiDirAbs) || !fs.statSync(apiDirAbs).isDirectory()) {
    return [];
  }
  const files: string[] = [];
  for (const name of ROUTE_FILENAMES) {
    const found = await fg(`**/${name}`, {
      cwd: apiDirAbs,
      absolute: true,
      onlyFiles: true,
    });
    files.push(...found);
  }
  return [...new Set(files)].sort();
}

/**
 * Given a route file path under apiRoutesDir, compute the API path (no leading /api/).
 * e.g. /repo/src/app/api/commercial-buildings/risk-areas/route.ts
 *  -> apiRoutesDir = src/app/api
 *  -> relative dir = commercial-buildings/risk-areas
 */
export function routeFileToApiPath(
  routeFilePath: string,
  rootDir: string,
  apiRoutesDir: string
): string {
  const apiDirAbs = path.resolve(rootDir, apiRoutesDir);
  const routeDir = path.dirname(routeFilePath);
  const relative = path.relative(apiDirAbs, routeDir);
  const normalized = path.normalize(relative).replace(/\\/g, "/");
  return normalized === "." ? "" : normalized;
}

function getNodeTextWithLimit(node: Node, maxLines: number): string | null {
  const fullText = node.getText();
  const lines = fullText.split(/\r?\n/);
  if (lines.length > maxLines) {
    const truncated = lines.slice(0, maxLines).join("\n");
    const trimmed = truncated.trim();
    return trimmed
      ? `${trimmed}\n\n/* ... truncated (max ${maxLines} lines) */`
      : null;
  }
  return fullText.trim();
}

function isExported(node: Node): boolean {
  const n = node as Node & { isExported?: () => boolean };
  if (typeof n.isExported === "function") return n.isExported();
  const modifiers =
    (node as Node & { getModifiers?: () => Node[] }).getModifiers?.() ?? [];
  return modifiers.some((m: Node) => m.getText() === "export");
}

/**
 * Find all exported HTTP method handlers in a route source file.
 */
function findAllExportedHandlers(
  sourceFile: SourceFile,
  maxLines: number
): { method: string; functionName: string; functionCode: string | null }[] {
  const results: { method: string; functionName: string; functionCode: string | null }[] = [];

  for (const methodName of HTTP_METHODS) {
    // FunctionDeclaration: export async function GET(...)
    const fnDecls = sourceFile.getDescendantsOfKind(
      SyntaxKind.FunctionDeclaration
    );
    for (const fn of fnDecls) {
      if (fn.getName() === methodName && isExported(fn)) {
        const code = getNodeTextWithLimit(fn, maxLines);
        results.push({
          method: methodName,
          functionName: methodName,
          functionCode: code,
        });
        break;
      }
    }
    if (results.some((r) => r.method === methodName)) continue;

    // VariableStatement: export const GET = async () => ...
    const varStmts = sourceFile.getDescendantsOfKind(
      SyntaxKind.VariableStatement
    );
    for (const stmt of varStmts) {
      if (!isExported(stmt)) continue;
      const declList = stmt.getDeclarationList();
      const decls = declList.getDeclarations();
      for (const decl of decls) {
        const nameNode = decl.getNameNode();
        if (
          nameNode.getKind() === SyntaxKind.Identifier &&
          (nameNode as Identifier).getText() === methodName
        ) {
          const code = getNodeTextWithLimit(stmt, maxLines);
          results.push({
            method: methodName,
            functionName: methodName,
            functionCode: code ?? null,
          });
          break;
        }
      }
      if (results.some((r) => r.method === methodName)) break;
    }
  }

  return results;
}

/**
 * Discover all route handlers from nested route files under apiRoutesDir.
 * Returns entries that can be turned into ApiCall objects and merged into the scan result.
 */
export async function discoverAllRouteHandlers(
  project: Project,
  rootDir: string,
  apiRoutesDir: string,
  maxFunctionLines: number = DEFAULT_MAX_FUNCTION_LINES
): Promise<DiscoveredRouteHandler[]> {
  const routeFiles = await findAllRouteFiles(rootDir, apiRoutesDir);
  const handlers: DiscoveredRouteHandler[] = [];

  for (const routeFile of routeFiles) {
    const apiPath = routeFileToApiPath(routeFile, rootDir, apiRoutesDir);
    const url = `/api/${apiPath.replace(/\/$/, "")}`;

    let sourceFile = project.getSourceFile(routeFile);
    if (!sourceFile) {
      try {
        sourceFile = project.addSourceFileAtPath(routeFile);
      } catch {
        continue;
      }
    }
    if (!sourceFile) continue;

    const methodHandlers = findAllExportedHandlers(sourceFile, maxFunctionLines);
    for (const h of methodHandlers) {
      handlers.push({
        method: h.method,
        url,
        functionFile: routeFile,
        functionName: h.functionName,
        functionCode: h.functionCode,
      });
    }
  }

  return handlers;
}

/**
 * Convert discovered route handlers to ApiCall[] so they can be merged into the scan result.
 */
export function discoveredHandlersToApiCalls(
  discovered: DiscoveredRouteHandler[]
): ApiCall[] {
  return discovered.map((h) => ({
    method: h.method,
    url: h.url,
    line: 1,
    column: 1,
    file: h.functionFile,
    source: "custom" as const,
    confidence: "high" as const,
    functionName: h.functionName,
    functionFile: h.functionFile,
    functionCode: h.functionCode ?? undefined,
    functionResolutionConfidence: "high" as const,
  }));
}
