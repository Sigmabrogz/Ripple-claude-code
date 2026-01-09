/**
 * Impact Calculator - Calculates the full impact of a code change
 * Combines dependency analysis, test coverage, and critical path detection
 */

import * as path from 'path';
import { minimatch } from 'minimatch';
import {
  Symbol,
  SymbolKind,
  Caller,
  ImpactAnalysis,
  ImpactSummary,
  TestMapping,
  RippleConfig,
  DEFAULT_CONFIG,
  FileLocation,
} from '../types.js';
import { DependencyGraphBuilder } from '../core/graph.js';
import { TestMapper } from './test-mapper.js';
import { RiskScorer } from './risk-scorer.js';
import { Parser } from '../core/parser.js';

export interface ImpactOptions {
  includeTransitive?: boolean;
  maxDepth?: number;
  verbose?: boolean;
}

export class ImpactCalculator {
  private config: RippleConfig;
  private riskScorer: RiskScorer;
  private parser: Parser;

  constructor(
    private rootDir: string,
    private graphBuilder: DependencyGraphBuilder,
    private testMapper: TestMapper,
    config: Partial<RippleConfig> = {}
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.riskScorer = new RiskScorer(this.config);
    this.parser = new Parser(rootDir);
  }

  /**
   * Calculate the full impact of changing a file
   */
  async analyzeFileImpact(
    filePath: string,
    options: ImpactOptions = {}
  ): Promise<ImpactAnalysis> {
    const { includeTransitive = true, maxDepth = 10 } = options;

    // Get the node for this file
    const node = this.graphBuilder.getNode(filePath);
    if (!node) {
      throw new Error(`File not found in dependency graph: ${filePath}`);
    }

    // Create a synthetic symbol for the whole file
    const fileSymbol: Symbol = {
      name: path.basename(filePath),
      kind: SymbolKind.Variable,
      location: {
        filePath,
        line: 1,
        column: 1,
      },
    };

    // Get direct dependents (files that import this file)
    const directDependentPaths = this.graphBuilder.getDirectDependents(filePath);
    const directCallers = await this.pathsToCallers(directDependentPaths, filePath);

    // Get transitive dependents
    let transitiveCallers: Caller[] = [];
    if (includeTransitive) {
      const transitivePaths = this.graphBuilder.getTransitiveDependents(filePath, maxDepth);
      // Exclude direct dependents from transitive list
      const transitiveOnly = transitivePaths.filter(
        (p) => !directDependentPaths.includes(p)
      );
      transitiveCallers = await this.pathsToCallers(transitiveOnly, filePath);
    }

    // Get test coverage information
    const testMapping = this.testMapper.getTestsForFile(filePath);
    const affectedTests = [testMapping];

    // Also get tests for dependent files
    for (const depPath of directDependentPaths) {
      const depTests = this.testMapper.getTestsForFile(depPath);
      if (depTests.testFiles.length > 0) {
        affectedTests.push(depTests);
      }
    }

    // Find callers without test coverage
    const allCallers = [...directCallers, ...transitiveCallers];
    const untestedCallers = allCallers.filter((caller) => {
      const callerTests = this.testMapper.getTestsForFile(caller.location.filePath);
      return callerTests.testFiles.length === 0;
    });

    // Calculate risk score
    const riskScore = this.riskScorer.calculateRisk({
      directCallers,
      transitiveCallers,
      untestedCallers,
      affectedTests,
      filePath,
    });

    // Generate summary
    const summary = this.generateSummary({
      directCallers,
      transitiveCallers,
      untestedCallers,
      affectedTests,
      riskScore,
    });

    return {
      target: fileSymbol,
      directCallers,
      transitiveCallers,
      affectedTests,
      untestedCallers,
      riskScore,
      summary,
    };
  }

  /**
   * Calculate impact of changing a specific symbol
   */
  async analyzeSymbolImpact(
    symbolName: string,
    filePath: string,
    options: ImpactOptions = {}
  ): Promise<ImpactAnalysis> {
    const { includeTransitive = true, maxDepth = 10 } = options;

    // Get the node and find the symbol
    const node = this.graphBuilder.getNode(filePath);
    if (!node) {
      throw new Error(`File not found in dependency graph: ${filePath}`);
    }

    const symbol = node.symbols.find((s) => s.name === symbolName);
    if (!symbol) {
      throw new Error(`Symbol '${symbolName}' not found in ${filePath}`);
    }

    // Check if the symbol is exported
    const isExported = node.exports.some((e) => e.name === symbolName);

    let directCallers: Caller[] = [];
    let transitiveCallers: Caller[] = [];

    if (isExported) {
      // Find files that import this symbol
      const directDependentPaths = this.graphBuilder.getDirectDependents(filePath);
      const importingFiles = directDependentPaths.filter((depPath) => {
        const depNode = this.graphBuilder.getNode(depPath);
        if (!depNode) return false;

        // Check if any import references our symbol
        return depNode.imports.some((imp) => {
          // Resolve the import to see if it points to our file
          return imp.specifiers.some(
            (spec) => spec.imported === symbolName || spec.imported === '*'
          );
        });
      });

      directCallers = await this.pathsToCallers(importingFiles, filePath, symbolName);

      if (includeTransitive) {
        const transitivePaths = this.graphBuilder.getTransitiveDependents(filePath, maxDepth);
        const transitiveOnly = transitivePaths.filter(
          (p) => !importingFiles.includes(p)
        );
        transitiveCallers = await this.pathsToCallers(transitiveOnly, filePath, symbolName);
      }
    }

    // Get test coverage
    const testMapping = this.testMapper.getTestsForFile(filePath);
    const affectedTests = [testMapping];

    // Find untested callers
    const allCallers = [...directCallers, ...transitiveCallers];
    const untestedCallers = allCallers.filter((caller) => {
      const callerTests = this.testMapper.getTestsForFile(caller.location.filePath);
      return callerTests.testFiles.length === 0;
    });

    // Calculate risk
    const riskScore = this.riskScorer.calculateRisk({
      directCallers,
      transitiveCallers,
      untestedCallers,
      affectedTests,
      filePath,
    });

    // Generate summary
    const summary = this.generateSummary({
      directCallers,
      transitiveCallers,
      untestedCallers,
      affectedTests,
      riskScore,
    });

    return {
      target: symbol,
      directCallers,
      transitiveCallers,
      affectedTests,
      untestedCallers,
      riskScore,
      summary,
    };
  }

  /**
   * Analyze impact of renaming a symbol
   */
  async analyzeRenameImpact(
    oldName: string,
    newName: string,
    filePath: string
  ): Promise<ImpactAnalysis & { renameLocations: FileLocation[] }> {
    // Get the base impact analysis
    const impact = await this.analyzeSymbolImpact(oldName, filePath);

    // Find all locations where the symbol is used
    const renameLocations: FileLocation[] = [];

    // Add the definition location
    renameLocations.push(impact.target.location);

    // Add all caller locations
    for (const caller of [...impact.directCallers, ...impact.transitiveCallers]) {
      renameLocations.push(caller.location);
    }

    return {
      ...impact,
      renameLocations,
    };
  }

  /**
   * Convert file paths to Caller objects
   */
  private async pathsToCallers(
    paths: string[],
    sourceFile: string,
    symbolName?: string
  ): Promise<Caller[]> {
    const callers: Caller[] = [];

    for (const depPath of paths) {
      const node = this.graphBuilder.getNode(depPath);
      if (!node) continue;

      // Find the import statement that references the source file
      for (const imp of node.imports) {
        // Normalize import source: strip relative prefixes and .js/.jsx extensions
        let importSource = imp.source;
        importSource = importSource.replace(/^\.\//, '').replace(/^\.\.\//, '');
        if (importSource.endsWith('.js')) {
          importSource = importSource.slice(0, -3);
        } else if (importSource.endsWith('.jsx')) {
          importSource = importSource.slice(0, -4);
        }

        // Check if import source matches the source file (by basename)
        const sourceBasename = path.basename(sourceFile).replace(/\.(ts|tsx|js|jsx)$/, '');
        if (
          importSource === sourceBasename ||
          importSource.endsWith('/' + sourceBasename) ||
          sourceFile.includes(importSource)
        ) {
          const isTestFile = this.testMapper.isTestFile(depPath);
          const isCriticalPath = this.isCriticalPath(depPath);

          // Get context snippet
          const context = this.parser.getContextSnippet(depPath, imp.location.line);

          // Create a symbol for the import
          const importSymbol: Symbol = {
            name: symbolName || path.basename(sourceFile),
            kind: SymbolKind.Variable,
            location: imp.location,
          };

          callers.push({
            location: imp.location,
            symbol: importSymbol,
            context,
            isTestFile,
            isCriticalPath,
          });
        }
      }
    }

    return callers;
  }

  /**
   * Check if a file is in a critical path
   */
  private isCriticalPath(filePath: string): boolean {
    const relativePath = path.relative(this.rootDir, filePath);

    for (const pattern of this.config.criticalPathPatterns) {
      if (minimatch(relativePath, pattern) || minimatch(filePath, pattern)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Generate a human-readable summary
   */
  private generateSummary(data: {
    directCallers: Caller[];
    transitiveCallers: Caller[];
    untestedCallers: Caller[];
    affectedTests: TestMapping[];
    riskScore: ReturnType<RiskScorer['calculateRisk']>;
  }): ImpactSummary {
    const totalCallers = data.directCallers.length + data.transitiveCallers.length;
    const testedCallers = totalCallers - data.untestedCallers.length;
    const criticalPathCallers = [...data.directCallers, ...data.transitiveCallers].filter(
      (c) => c.isCriticalPath
    ).length;

    // Count unique files
    const affectedFiles = new Set([
      ...data.directCallers.map((c) => c.location.filePath),
      ...data.transitiveCallers.map((c) => c.location.filePath),
    ]);

    // Generate recommendation
    let recommendation: string;
    if (data.riskScore.level === 'CRITICAL') {
      recommendation =
        'HIGH RISK: This change affects critical paths and has low test coverage. Consider adding tests before proceeding.';
    } else if (data.riskScore.level === 'HIGH') {
      recommendation =
        'CAUTION: This change has significant impact. Review all affected files carefully.';
    } else if (data.riskScore.level === 'MEDIUM') {
      recommendation =
        'MODERATE RISK: Some callers lack test coverage. Consider reviewing the untested paths.';
    } else {
      recommendation =
        'LOW RISK: This change has limited impact and good test coverage. Safe to proceed.';
    }

    return {
      totalCallers,
      testedCallers,
      untestedCallers: data.untestedCallers.length,
      criticalPathCallers,
      filesAffected: affectedFiles.size,
      recommendation,
    };
  }

  /**
   * Quick risk check for a file (faster than full analysis)
   */
  async quickRiskCheck(filePath: string): Promise<{
    riskLevel: string;
    callerCount: number;
    hasTests: boolean;
  }> {
    const directDependents = this.graphBuilder.getDirectDependents(filePath);
    const testMapping = this.testMapper.getTestsForFile(filePath);

    const callerCount = directDependents.length;
    const hasTests = testMapping.testFiles.length > 0;

    let riskLevel: string;
    if (callerCount > 20 && !hasTests) {
      riskLevel = 'CRITICAL';
    } else if (callerCount > 10 || !hasTests) {
      riskLevel = 'HIGH';
    } else if (callerCount > 5) {
      riskLevel = 'MEDIUM';
    } else {
      riskLevel = 'LOW';
    }

    return { riskLevel, callerCount, hasTests };
  }
}

export function createImpactCalculator(
  rootDir: string,
  graphBuilder: DependencyGraphBuilder,
  testMapper: TestMapper,
  config?: Partial<RippleConfig>
): ImpactCalculator {
  return new ImpactCalculator(rootDir, graphBuilder, testMapper, config);
}
