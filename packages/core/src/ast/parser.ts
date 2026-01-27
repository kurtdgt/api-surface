/**
 * AST Parser - initializes ts-morph Project and parses files
 */

import { Project, SourceFile, CompilerOptions } from 'ts-morph';
import * as path from 'path';
import { AstContext } from './context';

export interface AstParserOptions {
  rootDir: string;
  tsConfigPath?: string;
  compilerOptions?: CompilerOptions;
}

/**
 * AST Parser using ts-morph
 * Manages a Project instance and provides file parsing capabilities
 */
export class AstParser {
  private project: Project;

  constructor(private options: AstParserOptions) {
    this.project = this.initializeProject();
  }

  /**
   * Initialize ts-morph Project
   */
  private initializeProject(): Project {
    const { rootDir, tsConfigPath, compilerOptions } = this.options;

    // Try to find tsconfig.json if not provided
    const resolvedTsConfigPath = tsConfigPath 
      ? path.resolve(rootDir, tsConfigPath)
      : this.findTsConfig(rootDir);

    const projectOptions: any = {
      useInMemoryFileSystem: false,
    };

    // If tsconfig.json exists, use it
    if (resolvedTsConfigPath) {
      try {
        projectOptions.tsConfigFilePath = resolvedTsConfigPath;
      } catch (error) {
        // Fall back to manual compiler options
        console.warn(`Could not load tsconfig from ${resolvedTsConfigPath}, using defaults`);
      }
    }

    // Merge custom compiler options
    if (compilerOptions) {
      projectOptions.compilerOptions = {
        ...projectOptions.compilerOptions,
        ...compilerOptions,
      };
    }

    // Set default compiler options for JS/TS support
    if (!projectOptions.compilerOptions) {
      projectOptions.compilerOptions = {
        allowJs: true,
        checkJs: false,
        jsx: 2, // React
        module: 1, // ES2015
        target: 99, // ESNext
      };
    }

    return new Project(projectOptions);
  }

  /**
   * Find tsconfig.json in directory hierarchy
   */
  private findTsConfig(startDir: string): string | undefined {
    const fs = require('fs');
    let currentDir = path.resolve(startDir);

    while (currentDir !== path.dirname(currentDir)) {
      const tsConfigPath = path.join(currentDir, 'tsconfig.json');
      if (fs.existsSync(tsConfigPath)) {
        return tsConfigPath;
      }
      currentDir = path.dirname(currentDir);
    }

    return undefined;
  }

  /**
   * Parse a file and create an AST context
   */
  parseFile(filePath: string): AstContext | null {
    try {
      const absolutePath = path.isAbsolute(filePath) 
        ? filePath 
        : path.resolve(this.options.rootDir, filePath);

      // Check if file is already in project
      let sourceFile = this.project.getSourceFile(absolutePath);

      // If not, add it to the project
      if (!sourceFile) {
        sourceFile = this.project.addSourceFileAtPath(absolutePath);
      }

      if (!sourceFile) {
        return null;
      }

      return new AstContext(sourceFile, absolutePath, this.project);
    } catch (error) {
      console.error(`Failed to parse file ${filePath}:`, error);
      return null;
    }
  }

  /**
   * Parse multiple files
   */
  parseFiles(filePaths: string[]): AstContext[] {
    const contexts: AstContext[] = [];

    for (const filePath of filePaths) {
      const context = this.parseFile(filePath);
      if (context) {
        contexts.push(context);
      }
    }

    return contexts;
  }

  /**
   * Get the underlying ts-morph Project
   */
  getProject(): Project {
    return this.project;
  }

  /**
   * Clear all source files from the project
   */
  clear(): void {
    this.project.removeSourceFiles(this.project.getSourceFiles());
  }
}
