/**
 * Dependency Graph - Builds and maintains a graph of file dependencies
 * Supports incremental updates and caching
 */

import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';
import {
  DependencyGraph,
  GraphNode,
  RippleConfig,
  DEFAULT_CONFIG,
  FileLocation,
} from '../types.js';
import { Parser, ParseResult } from './parser.js';

export interface GraphBuildOptions {
  incremental?: boolean;
  verbose?: boolean;
}

export class DependencyGraphBuilder {
  private graph: DependencyGraph;
  private parser: Parser;
  private config: RippleConfig;
  private fileToNodeMap: Map<string, GraphNode> = new Map();

  constructor(
    private rootDir: string,
    config: Partial<RippleConfig> = {}
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.parser = new Parser(rootDir);
    this.graph = {
      nodes: new Map(),
      edges: new Map(),
      reverseEdges: new Map(),
    };
  }

  /**
   * Build the complete dependency graph from scratch
   */
  async build(options: GraphBuildOptions = {}): Promise<DependencyGraph> {
    const files = await this.discoverFiles();

    if (options.verbose) {
      console.log(`Discovered ${files.length} files to analyze`);
    }

    // Initialize parser with all files for better type resolution
    this.parser.initialize(files);

    // Parse all files and build nodes
    for (const file of files) {
      try {
        const parseResult = this.parser.parseFile(file);
        const node = this.parser.toGraphNode(parseResult);
        this.graph.nodes.set(file, node);
        this.fileToNodeMap.set(file, node);
      } catch (error) {
        if (options.verbose) {
          console.error(`Error parsing ${file}:`, error);
        }
      }
    }

    // Build edges from imports
    this.buildEdges();

    // Save to cache if enabled
    if (this.config.cacheEnabled) {
      await this.saveCache();
    }

    return this.graph;
  }

  /**
   * Update the graph incrementally for changed files
   */
  async updateIncremental(changedFiles: string[]): Promise<DependencyGraph> {
    for (const file of changedFiles) {
      // Remove old edges for this file
      this.removeEdgesForFile(file);

      // Re-parse the file
      try {
        const parseResult = this.parser.parseFile(file);
        const node = this.parser.toGraphNode(parseResult);
        this.graph.nodes.set(file, node);
        this.fileToNodeMap.set(file, node);
      } catch (error) {
        // File might have been deleted
        this.graph.nodes.delete(file);
        this.fileToNodeMap.delete(file);
      }
    }

    // Rebuild edges
    this.buildEdges();

    if (this.config.cacheEnabled) {
      await this.saveCache();
    }

    return this.graph;
  }

  /**
   * Discover all files matching the include patterns
   */
  private async discoverFiles(): Promise<string[]> {
    const allFiles: string[] = [];

    for (const pattern of this.config.includePaths) {
      const files = await glob(pattern, {
        cwd: this.rootDir,
        absolute: true,
        ignore: this.config.excludePaths,
      });
      allFiles.push(...files);
    }

    // Deduplicate
    return [...new Set(allFiles)];
  }

  /**
   * Build edges based on imports
   */
  private buildEdges(): void {
    // Clear existing edges
    this.graph.edges.clear();
    this.graph.reverseEdges.clear();

    for (const [filePath, node] of this.graph.nodes) {
      for (const importInfo of node.imports) {
        const resolvedPath = this.resolveImport(importInfo.source, filePath);
        if (resolvedPath && this.graph.nodes.has(resolvedPath)) {
          // Add forward edge: filePath depends on resolvedPath
          if (!this.graph.edges.has(filePath)) {
            this.graph.edges.set(filePath, new Set());
          }
          this.graph.edges.get(filePath)!.add(resolvedPath);

          // Add reverse edge: resolvedPath is depended on by filePath
          if (!this.graph.reverseEdges.has(resolvedPath)) {
            this.graph.reverseEdges.set(resolvedPath, new Set());
          }
          this.graph.reverseEdges.get(resolvedPath)!.add(filePath);
        }
      }
    }
  }

  /**
   * Resolve an import specifier to an absolute file path
   */
  private resolveImport(importSource: string, fromFile: string): string | null {
    const fromDir = path.dirname(fromFile);

    // Handle relative imports
    if (importSource.startsWith('.')) {
      // Strip .js/.jsx extension if present (ESM imports use .js but source is .ts)
      let baseImport = importSource;
      if (baseImport.endsWith('.js')) {
        baseImport = baseImport.slice(0, -3);
      } else if (baseImport.endsWith('.jsx')) {
        baseImport = baseImport.slice(0, -4);
      }

      const possibleExtensions = ['.ts', '.tsx', '.js', '.jsx', ''];
      const possiblePaths = [
        baseImport,
        `${baseImport}/index`,
      ];

      for (const basePath of possiblePaths) {
        for (const ext of possibleExtensions) {
          const fullPath = path.resolve(fromDir, `${basePath}${ext}`);
          if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
            return fullPath;
          }
        }
      }
    }

    // Handle absolute imports (configured in tsconfig paths)
    // For now, we'll try to resolve from node_modules or src
    const srcPath = path.resolve(this.rootDir, 'src', importSource);
    const possibleExtensions = ['.ts', '.tsx', '.js', '.jsx', ''];

    for (const ext of possibleExtensions) {
      const fullPath = `${srcPath}${ext}`;
      if (fs.existsSync(fullPath)) {
        return fullPath;
      }
    }

    // Check for index file
    for (const ext of possibleExtensions) {
      const indexPath = path.resolve(srcPath, `index${ext}`);
      if (fs.existsSync(indexPath)) {
        return indexPath;
      }
    }

    return null;
  }

  /**
   * Remove all edges for a specific file
   */
  private removeEdgesForFile(filePath: string): void {
    // Remove forward edges from this file
    const deps = this.graph.edges.get(filePath);
    if (deps) {
      for (const dep of deps) {
        this.graph.reverseEdges.get(dep)?.delete(filePath);
      }
      this.graph.edges.delete(filePath);
    }

    // Remove reverse edges to this file
    const dependents = this.graph.reverseEdges.get(filePath);
    if (dependents) {
      for (const dependent of dependents) {
        this.graph.edges.get(dependent)?.delete(filePath);
      }
      this.graph.reverseEdges.delete(filePath);
    }
  }

  /**
   * Get all files that directly import the target file
   */
  getDirectDependents(filePath: string): string[] {
    return Array.from(this.graph.reverseEdges.get(filePath) || []);
  }

  /**
   * Get all files that the target file directly imports
   */
  getDirectDependencies(filePath: string): string[] {
    return Array.from(this.graph.edges.get(filePath) || []);
  }

  /**
   * Get all files that transitively depend on the target file
   */
  getTransitiveDependents(filePath: string, maxDepth: number = 10): string[] {
    const visited = new Set<string>();
    const result: string[] = [];

    const traverse = (current: string, depth: number) => {
      if (depth > maxDepth || visited.has(current)) {
        return;
      }
      visited.add(current);

      const dependents = this.graph.reverseEdges.get(current);
      if (dependents) {
        for (const dep of dependents) {
          if (!visited.has(dep)) {
            result.push(dep);
            traverse(dep, depth + 1);
          }
        }
      }
    };

    traverse(filePath, 0);
    return result;
  }

  /**
   * Get all files that the target file transitively depends on
   */
  getTransitiveDependencies(filePath: string, maxDepth: number = 10): string[] {
    const visited = new Set<string>();
    const result: string[] = [];

    const traverse = (current: string, depth: number) => {
      if (depth > maxDepth || visited.has(current)) {
        return;
      }
      visited.add(current);

      const dependencies = this.graph.edges.get(current);
      if (dependencies) {
        for (const dep of dependencies) {
          if (!visited.has(dep)) {
            result.push(dep);
            traverse(dep, depth + 1);
          }
        }
      }
    };

    traverse(filePath, 0);
    return result;
  }

  /**
   * Find all usages of a specific symbol in the codebase
   */
  findSymbolUsages(symbolName: string, definedInFile: string): FileLocation[] {
    const usages: FileLocation[] = [];
    const dependents = this.getTransitiveDependents(definedInFile);

    // Check the file where it's defined
    const node = this.graph.nodes.get(definedInFile);
    if (node) {
      // Symbol is defined here, find usages in dependents
      for (const depFile of [definedInFile, ...dependents]) {
        const depNode = this.graph.nodes.get(depFile);
        if (depNode) {
          // Check if this file imports the symbol
          for (const imp of depNode.imports) {
            const resolvedPath = this.resolveImport(imp.source, depFile);
            if (resolvedPath === definedInFile) {
              // Check if the symbol is in the import specifiers
              for (const spec of imp.specifiers) {
                if (spec.imported === symbolName || spec.local === symbolName) {
                  usages.push(imp.location);
                }
              }
            }
          }
        }
      }
    }

    return usages;
  }

  /**
   * Get the node for a specific file
   */
  getNode(filePath: string): GraphNode | undefined {
    return this.graph.nodes.get(filePath);
  }

  /**
   * Get all nodes in the graph
   */
  getAllNodes(): GraphNode[] {
    return Array.from(this.graph.nodes.values());
  }

  /**
   * Save the graph to cache
   */
  private async saveCache(): Promise<void> {
    const cachePath = path.resolve(this.rootDir, this.config.cachePath);

    try {
      if (!fs.existsSync(cachePath)) {
        fs.mkdirSync(cachePath, { recursive: true });
      }

      const cacheData = {
        version: 1,
        timestamp: Date.now(),
        nodes: Array.from(this.graph.nodes.entries()),
        edges: Array.from(this.graph.edges.entries()).map(([k, v]) => [k, Array.from(v)]),
        reverseEdges: Array.from(this.graph.reverseEdges.entries()).map(([k, v]) => [k, Array.from(v)]),
      };

      fs.writeFileSync(
        path.join(cachePath, 'graph.json'),
        JSON.stringify(cacheData, null, 2)
      );
    } catch (error) {
      console.error('Failed to save cache:', error);
    }
  }

  /**
   * Load the graph from cache
   */
  async loadCache(): Promise<boolean> {
    const cacheFile = path.resolve(this.rootDir, this.config.cachePath, 'graph.json');

    try {
      if (!fs.existsSync(cacheFile)) {
        return false;
      }

      const cacheData = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));

      if (cacheData.version !== 1) {
        return false;
      }

      this.graph.nodes = new Map(cacheData.nodes);
      this.graph.edges = new Map(
        cacheData.edges.map(([k, v]: [string, string[]]) => [k, new Set(v)])
      );
      this.graph.reverseEdges = new Map(
        cacheData.reverseEdges.map(([k, v]: [string, string[]]) => [k, new Set(v)])
      );

      // Validate cache - check if any files have been modified
      for (const [filePath, node] of this.graph.nodes) {
        try {
          const stats = fs.statSync(filePath);
          if (stats.mtimeMs > node.lastModified) {
            // File has been modified, cache is stale
            return false;
          }
        } catch {
          // File doesn't exist anymore
          return false;
        }
      }

      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get graph statistics
   */
  getStats(): {
    totalFiles: number;
    totalEdges: number;
    averageDependencies: number;
    mostDependent: { file: string; count: number } | null;
    mostDependedOn: { file: string; count: number } | null;
  } {
    const totalFiles = this.graph.nodes.size;
    let totalEdges = 0;

    for (const deps of this.graph.edges.values()) {
      totalEdges += deps.size;
    }

    let mostDependent: { file: string; count: number } | null = null;
    for (const [file, deps] of this.graph.edges) {
      if (!mostDependent || deps.size > mostDependent.count) {
        mostDependent = { file, count: deps.size };
      }
    }

    let mostDependedOn: { file: string; count: number } | null = null;
    for (const [file, deps] of this.graph.reverseEdges) {
      if (!mostDependedOn || deps.size > mostDependedOn.count) {
        mostDependedOn = { file, count: deps.size };
      }
    }

    return {
      totalFiles,
      totalEdges,
      averageDependencies: totalFiles > 0 ? totalEdges / totalFiles : 0,
      mostDependent,
      mostDependedOn,
    };
  }
}

export function createGraphBuilder(
  rootDir: string,
  config?: Partial<RippleConfig>
): DependencyGraphBuilder {
  return new DependencyGraphBuilder(rootDir, config);
}
