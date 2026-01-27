/**
 * Visitor-style API for AST traversal and detection
 */

import { AstContext } from './context';
import { Node } from 'ts-morph';

/**
 * Visitor interface for AST traversal
 */
export interface AstVisitor {
  /**
   * Called when visiting a node
   * @param node - The AST node being visited
   * @param context - The AST context for the current file
   * @returns true to continue traversal, false to stop
   */
  visit(node: Node, context: AstContext): boolean | void;
}

/**
 * Base visitor class with helper methods
 */
export abstract class BaseAstVisitor implements AstVisitor {
  abstract visit(node: Node, context: AstContext): boolean | void;

  /**
   * Traverse all nodes in a context
   */
  traverse(context: AstContext): void {
    const sourceFile = context.sourceFile;
    this.traverseNode(sourceFile, context);
  }

  /**
   * Recursively traverse a node and its children
   */
  protected traverseNode(node: Node, context: AstContext): void {
    const shouldContinue = this.visit(node, context);
    
    if (shouldContinue !== false) {
      for (const child of node.getChildren()) {
        this.traverseNode(child, context);
      }
    }
  }

  /**
   * Get node position information
   */
  protected getNodePosition(node: Node): { line: number; column: number } {
    const { line, column } = node.getStartLineAndColumn();
    return { line, column };
  }

  /**
   * Get node text
   */
  protected getNodeText(node: Node): string {
    return node.getText();
  }
}

/**
 * Visitor manager - coordinates multiple visitors
 */
export class VisitorManager {
  private visitors: AstVisitor[] = [];

  /**
   * Add a visitor
   */
  addVisitor(visitor: AstVisitor): void {
    this.visitors.push(visitor);
  }

  /**
   * Remove a visitor
   */
  removeVisitor(visitor: AstVisitor): void {
    const index = this.visitors.indexOf(visitor);
    if (index > -1) {
      this.visitors.splice(index, 1);
    }
  }

  /**
   * Visit a context with all registered visitors
   */
  visit(context: AstContext): void {
    const sourceFile = context.sourceFile;
    
    for (const visitor of this.visitors) {
      if (visitor instanceof BaseAstVisitor) {
        visitor.traverse(context);
      } else {
        // For non-base visitors, traverse manually
        this.traverseWithVisitor(sourceFile, context, visitor);
      }
    }
  }

  /**
   * Traverse a node with a specific visitor
   */
  private traverseWithVisitor(node: Node, context: AstContext, visitor: AstVisitor): void {
    const shouldContinue = visitor.visit(node, context);
    
    if (shouldContinue !== false) {
      for (const child of node.getChildren()) {
        this.traverseWithVisitor(child, context, visitor);
      }
    }
  }

  /**
   * Clear all visitors
   */
  clear(): void {
    this.visitors = [];
  }
}
