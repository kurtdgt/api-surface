/**
 * AST Context - provides AST information and utilities for a single file
 */

import { SourceFile, ImportDeclaration, ImportSpecifier, Project, Node } from 'ts-morph';
import * as path from 'path';

export interface ImportInfo {
  moduleSpecifier: string;
  defaultImport?: string;
  namedImports: string[];
  namespaceImport?: string;
  isTypeOnly: boolean;
  line: number;
  column: number;
}

/**
 * AST Context for a single file
 * Provides access to source file, imports, and symbol resolution
 */
export class AstContext {
  constructor(
    public readonly sourceFile: SourceFile,
    public readonly filePath: string,
    private readonly project: Project
  ) {}

  /**
   * Get all import declarations from the file
   */
  getImports(): ImportInfo[] {
    const imports: ImportInfo[] = [];
    const importDeclarations = this.sourceFile.getImportDeclarations();

    for (const importDecl of importDeclarations) {
      const moduleSpecifier = importDecl.getModuleSpecifierValue();
      const isTypeOnly = importDecl.isTypeOnly();
      
      // Get default import
      const defaultImport = importDecl.getDefaultImport()?.getText();

      // Get namespace import
      const namespaceImport = importDecl.getNamespaceImport()?.getText();

      // Get named imports
      const namedImports: string[] = [];
      const namedImportsNode = importDecl.getNamedImports();
      for (const namedImport of namedImportsNode) {
        const name = namedImport.getName();
        const alias = namedImport.getAliasNode()?.getText();
        namedImports.push(alias || name);
      }

      // Get position
      const startLineAndColumn = importDecl.getStartLineAndColumn();

      imports.push({
        moduleSpecifier,
        defaultImport,
        namedImports,
        namespaceImport,
        isTypeOnly,
        line: startLineAndColumn.line,
        column: startLineAndColumn.column,
      });
    }

    return imports;
  }

  /**
   * Check if a module is imported
   */
  isModuleImported(moduleSpecifier: string): boolean {
    return this.getImports().some(
      imp => imp.moduleSpecifier === moduleSpecifier || 
             imp.moduleSpecifier.endsWith(moduleSpecifier)
    );
  }

  /**
   * Check if a specific named import exists
   */
  isNamedImportImported(moduleSpecifier: string, importName: string): boolean {
    const imports = this.getImports();
    return imports.some(imp => 
      (imp.moduleSpecifier === moduleSpecifier || 
       imp.moduleSpecifier.endsWith(moduleSpecifier)) &&
      imp.namedImports.includes(importName)
    );
  }

  /**
   * Get the resolved path of an import
   */
  resolveImportPath(moduleSpecifier: string): string | null {
    try {
      // Try to resolve using ts-morph's resolution
      const resolved = this.project.resolveModuleName(moduleSpecifier, this.filePath);
      return resolved?.getResolvedModule()?.getResolvedFileName() || null;
    } catch {
      return null;
    }
  }

  /**
   * Get the file's directory path
   */
  getDirectoryPath(): string {
    return path.dirname(this.filePath);
  }

  /**
   * Get the file's extension
   */
  getExtension(): string {
    return path.extname(this.filePath).toLowerCase();
  }

  /**
   * Check if file is TypeScript
   */
  isTypeScript(): boolean {
    const ext = this.getExtension();
    return ext === '.ts' || ext === '.tsx';
  }

  /**
   * Check if file is JavaScript
   */
  isJavaScript(): boolean {
    const ext = this.getExtension();
    return ext === '.js' || ext === '.jsx' || ext === '.mjs' || ext === '.cjs';
  }

  /**
   * Get the source text
   */
  getText(): string {
    return this.sourceFile.getFullText();
  }

  /**
   * Get all nodes of a specific kind
   */
  getNodesOfKind<T extends Node>(kind: number): T[] {
    return this.sourceFile.getDescendantsOfKind(kind) as T[];
  }
}
