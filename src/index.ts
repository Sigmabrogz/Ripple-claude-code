/**
 * Ripple - Impact Analysis Plugin for Claude Code
 * "See the blast radius before you edit"
 */

export * from './types.js';
export { Parser, createParser } from './core/parser.js';
export { DependencyGraphBuilder, createGraphBuilder } from './core/graph.js';
export { TestMapper, createTestMapper } from './analyzers/test-mapper.js';
export { ImpactCalculator, createImpactCalculator } from './analyzers/impact-calculator.js';
export { RiskScorer, createRiskScorer } from './analyzers/risk-scorer.js';

import * as path from 'path';
import * as fs from 'fs';
import {
  RippleConfig,
  DEFAULT_CONFIG,
  ImpactAnalysis,
  FileLocation,
} from './types.js';
import { DependencyGraphBuilder } from './core/graph.js';
import { TestMapper } from './analyzers/test-mapper.js';
import { ImpactCalculator, ImpactOptions } from './analyzers/impact-calculator.js';

export interface RippleInitOptions {
  verbose?: boolean;
  useCache?: boolean;
}

/**
 * Main Ripple class - orchestrates all analysis
 */
export class Ripple {
  private config: RippleConfig;
  private graphBuilder: DependencyGraphBuilder;
  private testMapper: TestMapper;
  private impactCalculator: ImpactCalculator;
  private initialized: boolean = false;

  constructor(
    private rootDir: string,
    config: Partial<RippleConfig> = {}
  ) {
    this.config = this.loadConfig(config);
    this.graphBuilder = new DependencyGraphBuilder(rootDir, this.config);
    this.testMapper = new TestMapper(rootDir, this.graphBuilder, this.config);
    this.impactCalculator = new ImpactCalculator(
      rootDir,
      this.graphBuilder,
      this.testMapper,
      this.config
    );
  }

  /**
   * Load configuration from file or use defaults
   */
  private loadConfig(overrides: Partial<RippleConfig>): RippleConfig {
    // Try to load .ripplerc or ripple.config.json
    const configPaths = [
      path.join(this.rootDir, '.ripplerc'),
      path.join(this.rootDir, '.ripplerc.json'),
      path.join(this.rootDir, 'ripple.config.json'),
    ];

    for (const configPath of configPaths) {
      try {
        if (fs.existsSync(configPath)) {
          const fileConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
          return { ...DEFAULT_CONFIG, ...fileConfig, ...overrides };
        }
      } catch {
        // Continue to next config file
      }
    }

    return { ...DEFAULT_CONFIG, ...overrides };
  }

  /**
   * Initialize Ripple - build or load the dependency graph
   */
  async initialize(options: RippleInitOptions = {}): Promise<void> {
    const { verbose = false, useCache = true } = options;

    // Try to load from cache first
    if (useCache && this.config.cacheEnabled) {
      const cacheLoaded = await this.graphBuilder.loadCache();
      if (cacheLoaded) {
        if (verbose) {
          console.log('Loaded dependency graph from cache');
        }
        await this.testMapper.initialize();
        this.initialized = true;
        return;
      }
    }

    // Build the graph from scratch
    if (verbose) {
      console.log('Building dependency graph...');
    }

    await this.graphBuilder.build({ verbose });
    await this.testMapper.initialize();
    this.initialized = true;

    if (verbose) {
      const stats = this.graphBuilder.getStats();
      console.log(`Graph built: ${stats.totalFiles} files, ${stats.totalEdges} dependencies`);
    }
  }

  /**
   * Ensure Ripple is initialized
   */
  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('Ripple not initialized. Call initialize() first.');
    }
  }

  /**
   * Analyze the impact of changing a file
   */
  async analyzeFile(filePath: string, options?: ImpactOptions): Promise<ImpactAnalysis> {
    this.ensureInitialized();
    const absolutePath = path.resolve(this.rootDir, filePath);
    return this.impactCalculator.analyzeFileImpact(absolutePath, options);
  }

  /**
   * Analyze the impact of changing a specific symbol
   */
  async analyzeSymbol(
    symbolName: string,
    filePath: string,
    options?: ImpactOptions
  ): Promise<ImpactAnalysis> {
    this.ensureInitialized();
    const absolutePath = path.resolve(this.rootDir, filePath);
    return this.impactCalculator.analyzeSymbolImpact(symbolName, absolutePath, options);
  }

  /**
   * Analyze the impact of renaming a symbol
   */
  async analyzeRename(
    oldName: string,
    newName: string,
    filePath: string
  ): Promise<ImpactAnalysis & { renameLocations: FileLocation[] }> {
    this.ensureInitialized();
    const absolutePath = path.resolve(this.rootDir, filePath);
    return this.impactCalculator.analyzeRenameImpact(oldName, newName, absolutePath);
  }

  /**
   * Quick risk check for a file
   */
  async quickRiskCheck(filePath: string): Promise<{
    riskLevel: string;
    callerCount: number;
    hasTests: boolean;
  }> {
    this.ensureInitialized();
    const absolutePath = path.resolve(this.rootDir, filePath);
    return this.impactCalculator.quickRiskCheck(absolutePath);
  }

  /**
   * Update the graph for changed files
   */
  async updateGraph(changedFiles: string[]): Promise<void> {
    this.ensureInitialized();
    const absolutePaths = changedFiles.map((f) => path.resolve(this.rootDir, f));
    await this.graphBuilder.updateIncremental(absolutePaths);
  }

  /**
   * Get statistics about the current state
   */
  getStats(): {
    graph: ReturnType<DependencyGraphBuilder['getStats']>;
    tests: ReturnType<TestMapper['getStats']>;
  } {
    this.ensureInitialized();
    return {
      graph: this.graphBuilder.getStats(),
      tests: this.testMapper.getStats(),
    };
  }

  /**
   * Get the current configuration
   */
  getConfig(): RippleConfig {
    return { ...this.config };
  }

  /**
   * Get direct dependents of a file
   */
  getDependents(filePath: string): string[] {
    this.ensureInitialized();
    const absolutePath = path.resolve(this.rootDir, filePath);
    return this.graphBuilder.getDirectDependents(absolutePath);
  }

  /**
   * Get direct dependencies of a file
   */
  getDependencies(filePath: string): string[] {
    this.ensureInitialized();
    const absolutePath = path.resolve(this.rootDir, filePath);
    return this.graphBuilder.getDirectDependencies(absolutePath);
  }

  /**
   * Check if a file is a test file
   */
  isTestFile(filePath: string): boolean {
    this.ensureInitialized();
    const absolutePath = path.resolve(this.rootDir, filePath);
    return this.testMapper.isTestFile(absolutePath);
  }
}

/**
 * Create a new Ripple instance
 */
export function createRipple(
  rootDir: string,
  config?: Partial<RippleConfig>
): Ripple {
  return new Ripple(rootDir, config);
}
