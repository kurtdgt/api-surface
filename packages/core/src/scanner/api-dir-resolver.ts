/**
 * API directory resolver - when apiRoutesDir is set, discover all files
 * inside that directory and their "related" files (imported modules within the repo).
 * Used so the scan does not miss dependencies of API route handlers.
 */

import fg from "fast-glob";
import * as fs from "fs";
import * as path from "path";
import type { AstParser } from "../ast/parser";
import type { AstContext } from "../ast/context";

const DEFAULT_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];

export interface ApiDirResolutionResult {
  /** All files under the API directory */
  apiDirFiles: string[];
  /** Files outside the API dir that are imported by API dir files (within repo) */
  relatedFiles: string[];
  /** Combined unique list: apiDirFiles + relatedFiles */
  allFiles: string[];
}

/**
 * Resolve a relative module specifier to an absolute file path.
 * Tries the exact path, then with extensions, then as directory with index.
 */
function resolveRelativeSpecifier(
  specifier: string,
  fromFile: string,
  rootDir: string
): string | null {
  if (!specifier.startsWith(".")) return null;
  const fromDir = path.dirname(fromFile);
  const resolved = path.resolve(fromDir, specifier);
  const normalizedRoot = path.resolve(rootDir);
  if (!resolved.startsWith(normalizedRoot)) return null;

  if (fs.existsSync(resolved)) {
    const stat = fs.statSync(resolved);
    if (stat.isFile()) return resolved;
    if (stat.isDirectory()) {
      for (const ext of DEFAULT_EXTENSIONS) {
        const indexPath = path.join(resolved, `index${ext}`);
        if (fs.existsSync(indexPath)) return indexPath;
      }
    }
    return null;
  }

  for (const ext of DEFAULT_EXTENSIONS) {
    const withExt = resolved + ext;
    if (fs.existsSync(withExt)) return withExt;
  }

  return null;
}

/**
 * Try to resolve path alias (e.g. @/lib/foo) using rootDir.
 * Common pattern: @/ -> rootDir or rootDir/src
 */
function resolvePathAlias(
  specifier: string,
  rootDir: string
): string | null {
  const normalizedRoot = path.resolve(rootDir);
  let candidate: string | undefined;
  if (specifier.startsWith("@/")) {
    candidate = path.join(normalizedRoot, specifier.slice(2));
  } else if (specifier.startsWith("~/")) {
    candidate = path.join(normalizedRoot, specifier.slice(2));
  } else {
    return null;
  }
  if (!candidate.startsWith(normalizedRoot)) return null;
  if (fs.existsSync(candidate)) {
    const stat = fs.statSync(candidate);
    if (stat.isFile()) return candidate;
    if (stat.isDirectory()) {
      for (const ext of DEFAULT_EXTENSIONS) {
        const indexPath = path.join(candidate, `index${ext}`);
        if (fs.existsSync(indexPath)) return indexPath;
      }
    }
  }
  for (const ext of DEFAULT_EXTENSIONS) {
    const withExt = candidate + ext;
    if (fs.existsSync(withExt)) return withExt;
  }
  return null;
}

/**
 * Get all files under the API routes directory (same extensions as main scan).
 */
export async function getFilesInApiDir(
  rootDir: string,
  apiRoutesDir: string
): Promise<string[]> {
  const apiDirAbs = path.resolve(rootDir, apiRoutesDir);
  try {
    if (!fs.existsSync(apiDirAbs) || !fs.statSync(apiDirAbs).isDirectory()) {
      return [];
    }
  } catch {
    return [];
  }
  const files = await fg("**/*.{ts,tsx,js,jsx,mjs,cjs}", {
    cwd: apiDirAbs,
    absolute: true,
    onlyFiles: true,
    dot: false,
  });
  return files.sort();
}

/**
 * Discover all files in the API directory and their related files (imports that
 * resolve to files inside the repo). Uses the AST parser to get imports from each file.
 */
export async function getApiDirFilesWithRelated(
  rootDir: string,
  apiRoutesDir: string,
  astParser: AstParser
): Promise<ApiDirResolutionResult> {
  const apiDirFiles = await getFilesInApiDir(rootDir, apiRoutesDir);
  const relatedSet = new Set<string>();
  const normalizedRoot = path.resolve(rootDir);

  for (const filePath of apiDirFiles) {
    const context = astParser.parseFile(filePath) as AstContext | null;
    if (!context) continue;

    const imports = context.getImports();
    for (const imp of imports) {
      const specifier = imp.moduleSpecifier;
      let resolved: string | null = null;

      if (specifier.startsWith(".")) {
        resolved = resolveRelativeSpecifier(specifier, filePath, rootDir);
      } else if (specifier.startsWith("@/") || specifier.startsWith("~/")) {
        resolved = resolvePathAlias(specifier, rootDir);
      }
      if (!resolved && !specifier.startsWith(".") && !path.isAbsolute(specifier)) {
        try {
          resolved = context.resolveImportPath(specifier);
        } catch {
          // ignore
        }
      }
      if (resolved && resolved.startsWith(normalizedRoot) && fs.existsSync(resolved)) {
        const stat = fs.statSync(resolved);
        if (stat.isFile()) {
          relatedSet.add(resolved);
        }
      }
    }
  }

  const relatedFiles = [...relatedSet].filter(
    (f) => !apiDirFiles.includes(f)
  ).sort();
  const allSet = new Set([...apiDirFiles, ...relatedFiles]);
  const allFiles = [...allSet].sort();

  return {
    apiDirFiles,
    relatedFiles,
    allFiles,
  };
}
