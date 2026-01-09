/**
 * AST Parser - Extracts symbols, imports, and exports from TypeScript/JavaScript files
 * Uses TypeScript compiler API for accurate parsing
 */

import * as ts from 'typescript';
import * as path from 'path';
import * as fs from 'fs';
import {
  Symbol,
  SymbolKind,
  FileLocation,
  ImportInfo,
  ImportSpecifier,
  ExportInfo,
  GraphNode,
} from '../types.js';

export interface ParseResult {
  filePath: string;
  symbols: Symbol[];
  imports: ImportInfo[];
  exports: ExportInfo[];
  errors: string[];
}

export class Parser {
  private program: ts.Program | null = null;
  private checker: ts.TypeChecker | null = null;

  constructor(private rootDir: string) {}

  /**
   * Initialize the TypeScript program for a set of files
   */
  initialize(files: string[]): void {
    const configPath = ts.findConfigFile(this.rootDir, ts.sys.fileExists, 'tsconfig.json');

    let compilerOptions: ts.CompilerOptions = {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      allowJs: true,
      checkJs: false,
      noEmit: true,
    };

    if (configPath) {
      const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
      if (!configFile.error) {
        const parsed = ts.parseJsonConfigFileContent(
          configFile.config,
          ts.sys,
          path.dirname(configPath)
        );
        compilerOptions = { ...compilerOptions, ...parsed.options };
      }
    }

    this.program = ts.createProgram(files, compilerOptions);
    this.checker = this.program.getTypeChecker();
  }

  /**
   * Parse a single file and extract all relevant information
   */
  parseFile(filePath: string): ParseResult {
    const result: ParseResult = {
      filePath,
      symbols: [],
      imports: [],
      exports: [],
      errors: [],
    };

    if (!this.program) {
      // Create a minimal program for single file parsing
      this.initialize([filePath]);
    }

    const sourceFile = this.program!.getSourceFile(filePath);
    if (!sourceFile) {
      result.errors.push(`Could not find source file: ${filePath}`);
      return result;
    }

    // Extract imports
    result.imports = this.extractImports(sourceFile);

    // Extract exports and symbols
    const { symbols, exports } = this.extractSymbolsAndExports(sourceFile);
    result.symbols = symbols;
    result.exports = exports;

    return result;
  }

  /**
   * Extract all imports from a source file
   */
  private extractImports(sourceFile: ts.SourceFile): ImportInfo[] {
    const imports: ImportInfo[] = [];

    const visit = (node: ts.Node) => {
      if (ts.isImportDeclaration(node)) {
        const importInfo = this.parseImportDeclaration(node, sourceFile);
        if (importInfo) {
          imports.push(importInfo);
        }
      }
      // Handle require() calls
      if (ts.isCallExpression(node) &&
          ts.isIdentifier(node.expression) &&
          node.expression.text === 'require' &&
          node.arguments.length > 0 &&
          ts.isStringLiteral(node.arguments[0])) {
        const source = node.arguments[0].text;
        const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
        imports.push({
          source,
          specifiers: [{ imported: '*', local: '*', isDefault: false, isNamespace: true }],
          location: {
            filePath: sourceFile.fileName,
            line: line + 1,
            column: character + 1,
          },
        });
      }
      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
    return imports;
  }

  /**
   * Parse an import declaration into ImportInfo
   */
  private parseImportDeclaration(
    node: ts.ImportDeclaration,
    sourceFile: ts.SourceFile
  ): ImportInfo | null {
    if (!ts.isStringLiteral(node.moduleSpecifier)) {
      return null;
    }

    const source = node.moduleSpecifier.text;
    const specifiers: ImportSpecifier[] = [];
    const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart());

    const importClause = node.importClause;
    if (importClause) {
      // Default import: import Foo from 'bar'
      if (importClause.name) {
        specifiers.push({
          imported: 'default',
          local: importClause.name.text,
          isDefault: true,
          isNamespace: false,
        });
      }

      // Named imports: import { Foo, Bar as Baz } from 'bar'
      if (importClause.namedBindings) {
        if (ts.isNamedImports(importClause.namedBindings)) {
          for (const element of importClause.namedBindings.elements) {
            specifiers.push({
              imported: element.propertyName?.text || element.name.text,
              local: element.name.text,
              isDefault: false,
              isNamespace: false,
            });
          }
        }
        // Namespace import: import * as Foo from 'bar'
        else if (ts.isNamespaceImport(importClause.namedBindings)) {
          specifiers.push({
            imported: '*',
            local: importClause.namedBindings.name.text,
            isDefault: false,
            isNamespace: true,
          });
        }
      }
    }

    return {
      source,
      specifiers,
      location: {
        filePath: sourceFile.fileName,
        line: line + 1,
        column: character + 1,
      },
    };
  }

  /**
   * Extract all symbols and exports from a source file
   */
  private extractSymbolsAndExports(
    sourceFile: ts.SourceFile
  ): { symbols: Symbol[]; exports: ExportInfo[] } {
    const symbols: Symbol[] = [];
    const exports: ExportInfo[] = [];

    const visit = (node: ts.Node) => {
      const symbol = this.extractSymbol(node, sourceFile);
      if (symbol) {
        symbols.push(symbol);

        // Check if this is exported
        if (this.isExported(node)) {
          exports.push({
            name: symbol.name,
            kind: symbol.kind,
            location: symbol.location,
            isDefault: this.isDefaultExport(node),
          });
        }
      }

      // Handle export statements
      if (ts.isExportDeclaration(node)) {
        const exportInfos = this.parseExportDeclaration(node, sourceFile);
        exports.push(...exportInfos);
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
    return { symbols, exports };
  }

  /**
   * Extract a symbol from a node if it defines one
   */
  private extractSymbol(node: ts.Node, sourceFile: ts.SourceFile): Symbol | null {
    const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
    const location: FileLocation = {
      filePath: sourceFile.fileName,
      line: line + 1,
      column: character + 1,
    };

    // Function declarations
    if (ts.isFunctionDeclaration(node) && node.name) {
      return {
        name: node.name.text,
        kind: SymbolKind.Function,
        location,
      };
    }

    // Class declarations
    if (ts.isClassDeclaration(node) && node.name) {
      return {
        name: node.name.text,
        kind: SymbolKind.Class,
        location,
      };
    }

    // Variable declarations (const, let, var)
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      // Check if it's a function expression or arrow function
      const kind = node.initializer &&
        (ts.isFunctionExpression(node.initializer) || ts.isArrowFunction(node.initializer))
        ? SymbolKind.Function
        : SymbolKind.Variable;

      return {
        name: node.name.text,
        kind,
        location,
      };
    }

    // Interface declarations
    if (ts.isInterfaceDeclaration(node)) {
      return {
        name: node.name.text,
        kind: SymbolKind.Interface,
        location,
      };
    }

    // Type alias declarations
    if (ts.isTypeAliasDeclaration(node)) {
      return {
        name: node.name.text,
        kind: SymbolKind.Type,
        location,
      };
    }

    // Enum declarations
    if (ts.isEnumDeclaration(node)) {
      return {
        name: node.name.text,
        kind: SymbolKind.Enum,
        location,
      };
    }

    // Method declarations (inside classes)
    if (ts.isMethodDeclaration(node) && ts.isIdentifier(node.name)) {
      return {
        name: node.name.text,
        kind: SymbolKind.Method,
        location,
      };
    }

    return null;
  }

  /**
   * Check if a node is exported
   */
  private isExported(node: ts.Node): boolean {
    if (!ts.canHaveModifiers(node)) {
      return false;
    }
    const modifiers = ts.getModifiers(node);
    if (!modifiers) {
      return false;
    }
    return modifiers.some(
      (m) => m.kind === ts.SyntaxKind.ExportKeyword
    );
  }

  /**
   * Check if a node is a default export
   */
  private isDefaultExport(node: ts.Node): boolean {
    if (!ts.canHaveModifiers(node)) {
      return false;
    }
    const modifiers = ts.getModifiers(node);
    if (!modifiers) {
      return false;
    }
    return modifiers.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword);
  }

  /**
   * Parse export declaration (export { ... } or export * from ...)
   */
  private parseExportDeclaration(
    node: ts.ExportDeclaration,
    sourceFile: ts.SourceFile
  ): ExportInfo[] {
    const exports: ExportInfo[] = [];
    const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
    const location: FileLocation = {
      filePath: sourceFile.fileName,
      line: line + 1,
      column: character + 1,
    };

    if (node.exportClause && ts.isNamedExports(node.exportClause)) {
      for (const element of node.exportClause.elements) {
        exports.push({
          name: element.name.text,
          kind: SymbolKind.Variable, // We don't know the kind from just the export
          location,
          isDefault: false,
        });
      }
    }

    return exports;
  }

  /**
   * Find all references to a symbol across files
   */
  findReferences(symbolName: string, filePath: string): FileLocation[] {
    const references: FileLocation[] = [];

    if (!this.program || !this.checker) {
      return references;
    }

    const sourceFile = this.program.getSourceFile(filePath);
    if (!sourceFile) {
      return references;
    }

    // Find the symbol definition
    const visit = (node: ts.Node) => {
      if (ts.isIdentifier(node) && node.text === symbolName) {
        const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
        references.push({
          filePath: sourceFile.fileName,
          line: line + 1,
          column: character + 1,
        });
      }
      ts.forEachChild(node, visit);
    };

    // Search all source files
    for (const sf of this.program.getSourceFiles()) {
      if (!sf.isDeclarationFile) {
        ts.forEachChild(sf, (node) => {
          const innerVisit = (n: ts.Node) => {
            if (ts.isIdentifier(n) && n.text === symbolName) {
              const { line, character } = sf.getLineAndCharacterOfPosition(n.getStart());
              references.push({
                filePath: sf.fileName,
                line: line + 1,
                column: character + 1,
              });
            }
            ts.forEachChild(n, innerVisit);
          };
          innerVisit(node);
        });
      }
    }

    return references;
  }

  /**
   * Get code snippet around a location
   */
  getContextSnippet(filePath: string, line: number, contextLines: number = 2): string {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');
      const startLine = Math.max(0, line - contextLines - 1);
      const endLine = Math.min(lines.length, line + contextLines);
      return lines.slice(startLine, endLine).join('\n');
    } catch {
      return '';
    }
  }

  /**
   * Convert ParseResult to GraphNode
   */
  toGraphNode(parseResult: ParseResult): GraphNode {
    const stats = fs.statSync(parseResult.filePath);
    return {
      filePath: parseResult.filePath,
      symbols: parseResult.symbols,
      imports: parseResult.imports,
      exports: parseResult.exports,
      lastModified: stats.mtimeMs,
    };
  }
}

export function createParser(rootDir: string): Parser {
  return new Parser(rootDir);
}
