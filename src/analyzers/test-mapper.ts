/**
 * Test Mapper - Maps source files to their test files
 * Uses naming conventions, import analysis, and coverage data
 */

import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';
import {
  TestMapping,
  CoverageInfo,
  RippleConfig,
  DEFAULT_CONFIG,
} from '../types.js';
import { DependencyGraphBuilder } from '../core/graph.js';

export interface CoverageData {
  [filePath: string]: {
    lines: { [lineNumber: string]: number };
    branches: { [branchId: string]: number };
    functions: { [funcName: string]: number };
  };
}

export class TestMapper {
  private config: RippleConfig;
  private testFiles: Set<string> = new Set();
  private coverageData: CoverageData | null = null;

  constructor(
    private rootDir: string,
    private graphBuilder: DependencyGraphBuilder,
    config: Partial<RippleConfig> = {}
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Initialize the test mapper by discovering test files
   */
  async initialize(): Promise<void> {
    await this.discoverTestFiles();
    await this.loadCoverageData();
  }

  /**
   * Discover all test files in the project
   */
  private async discoverTestFiles(): Promise<void> {
    this.testFiles.clear();

    for (const pattern of this.config.testPatterns) {
      const files = await glob(pattern, {
        cwd: this.rootDir,
        absolute: true,
        ignore: ['node_modules/**'],
      });
      files.forEach((f) => this.testFiles.add(f));
    }
  }

  /**
   * Load coverage data from common coverage output locations
   */
  private async loadCoverageData(): Promise<void> {
    const coveragePaths = [
      path.join(this.rootDir, 'coverage', 'coverage-final.json'),
      path.join(this.rootDir, 'coverage', 'lcov.json'),
      path.join(this.rootDir, '.nyc_output', 'coverage.json'),
    ];

    for (const coveragePath of coveragePaths) {
      try {
        if (fs.existsSync(coveragePath)) {
          const data = JSON.parse(fs.readFileSync(coveragePath, 'utf-8'));
          this.coverageData = this.normalizeCoverageData(data);
          return;
        }
      } catch {
        // Continue trying other paths
      }
    }
  }

  /**
   * Normalize coverage data from different formats
   */
  private normalizeCoverageData(data: unknown): CoverageData {
    // Handle Istanbul/NYC format
    if (typeof data === 'object' && data !== null) {
      const normalized: CoverageData = {};

      for (const [filePath, coverage] of Object.entries(data as Record<string, unknown>)) {
        if (typeof coverage === 'object' && coverage !== null) {
          const cov = coverage as Record<string, unknown>;
          normalized[filePath] = {
            lines: (cov.l || cov.lines || {}) as { [key: string]: number },
            branches: (cov.b || cov.branches || {}) as { [key: string]: number },
            functions: (cov.f || cov.functions || {}) as { [key: string]: number },
          };
        }
      }

      return normalized;
    }

    return {};
  }

  /**
   * Check if a file is a test file
   */
  isTestFile(filePath: string): boolean {
    return this.testFiles.has(filePath);
  }

  /**
   * Get test files for a source file
   */
  getTestsForFile(sourceFile: string): TestMapping {
    const testFiles: string[] = [];

    // Strategy 1: Naming convention (foo.ts -> foo.test.ts, foo.spec.ts)
    const conventionTests = this.findByNamingConvention(sourceFile);
    testFiles.push(...conventionTests);

    // Strategy 2: Import analysis (which test files import this source file)
    const importTests = this.findByImportAnalysis(sourceFile);
    testFiles.push(...importTests);

    // Strategy 3: Co-located tests (__tests__ directory)
    const colocatedTests = this.findColocatedTests(sourceFile);
    testFiles.push(...colocatedTests);

    // Deduplicate
    const uniqueTestFiles = [...new Set(testFiles)];

    // Get coverage info
    const coverage = this.getCoverageForFile(sourceFile);

    return {
      sourceFile,
      testFiles: uniqueTestFiles,
      coverage,
    };
  }

  /**
   * Find tests by naming convention
   */
  private findByNamingConvention(sourceFile: string): string[] {
    const tests: string[] = [];
    const parsed = path.parse(sourceFile);
    const baseName = parsed.name;
    const dir = parsed.dir;

    // Common test file naming patterns
    const testPatterns = [
      `${baseName}.test`,
      `${baseName}.spec`,
      `${baseName}-test`,
      `${baseName}_test`,
    ];

    const extensions = ['.ts', '.tsx', '.js', '.jsx'];

    for (const pattern of testPatterns) {
      for (const ext of extensions) {
        // Same directory
        const sameDirPath = path.join(dir, `${pattern}${ext}`);
        if (this.testFiles.has(sameDirPath)) {
          tests.push(sameDirPath);
        }

        // __tests__ subdirectory
        const testsDirPath = path.join(dir, '__tests__', `${pattern}${ext}`);
        if (this.testFiles.has(testsDirPath)) {
          tests.push(testsDirPath);
        }

        // tests subdirectory at same level
        const testsSiblingPath = path.join(dir, 'tests', `${pattern}${ext}`);
        if (this.testFiles.has(testsSiblingPath)) {
          tests.push(testsSiblingPath);
        }
      }
    }

    return tests;
  }

  /**
   * Find tests that import the source file
   */
  private findByImportAnalysis(sourceFile: string): string[] {
    const tests: string[] = [];
    const dependents = this.graphBuilder.getDirectDependents(sourceFile);

    for (const dep of dependents) {
      if (this.testFiles.has(dep)) {
        tests.push(dep);
      }
    }

    return tests;
  }

  /**
   * Find co-located tests in __tests__ directories
   */
  private findColocatedTests(sourceFile: string): string[] {
    const tests: string[] = [];
    const parsed = path.parse(sourceFile);
    const baseName = parsed.name;

    // Look in parent's __tests__ directory
    const parentTestsDir = path.join(path.dirname(parsed.dir), '__tests__');

    for (const testFile of this.testFiles) {
      if (testFile.startsWith(parentTestsDir)) {
        const testBaseName = path.parse(testFile).name
          .replace(/\.(test|spec)$/, '')
          .replace(/-(test|spec)$/, '')
          .replace(/_(test|spec)$/, '');

        if (testBaseName === baseName) {
          tests.push(testFile);
        }
      }
    }

    return tests;
  }

  /**
   * Get coverage information for a file
   */
  getCoverageForFile(filePath: string): CoverageInfo | null {
    if (!this.coverageData) {
      return null;
    }

    // Try to find coverage data with different path formats
    const possiblePaths = [
      filePath,
      path.relative(this.rootDir, filePath),
      path.resolve(filePath),
    ];

    for (const p of possiblePaths) {
      if (this.coverageData[p]) {
        const data = this.coverageData[p];
        return this.calculateCoverageInfo(data);
      }
    }

    return null;
  }

  /**
   * Calculate coverage info from raw coverage data
   */
  private calculateCoverageInfo(data: {
    lines: { [key: string]: number };
    branches: { [key: string]: number };
  }): CoverageInfo {
    const lineEntries = Object.values(data.lines);
    const branchEntries = Object.values(data.branches);

    const linesTotal = lineEntries.length;
    const linesCovered = lineEntries.filter((v) => v > 0).length;

    const branchesTotal = branchEntries.length;
    const branchesCovered = branchEntries.filter((v) => v > 0).length;

    return {
      lines: {
        total: linesTotal,
        covered: linesCovered,
        percentage: linesTotal > 0 ? (linesCovered / linesTotal) * 100 : 0,
      },
      branches: {
        total: branchesTotal,
        covered: branchesCovered,
        percentage: branchesTotal > 0 ? (branchesCovered / branchesTotal) * 100 : 0,
      },
    };
  }

  /**
   * Get all test files
   */
  getAllTestFiles(): string[] {
    return Array.from(this.testFiles);
  }

  /**
   * Check if a specific line is covered by tests
   */
  isLineCovered(filePath: string, lineNumber: number): boolean {
    if (!this.coverageData) {
      return false; // Unknown, assume not covered
    }

    const possiblePaths = [
      filePath,
      path.relative(this.rootDir, filePath),
      path.resolve(filePath),
    ];

    for (const p of possiblePaths) {
      if (this.coverageData[p]) {
        const lineData = this.coverageData[p].lines;
        return lineData[lineNumber.toString()] > 0;
      }
    }

    return false;
  }

  /**
   * Get uncovered lines in a range
   */
  getUncoveredLinesInRange(
    filePath: string,
    startLine: number,
    endLine: number
  ): number[] {
    const uncovered: number[] = [];

    for (let line = startLine; line <= endLine; line++) {
      if (!this.isLineCovered(filePath, line)) {
        uncovered.push(line);
      }
    }

    return uncovered;
  }

  /**
   * Get statistics about test coverage
   */
  getStats(): {
    totalTestFiles: number;
    hasCoverageData: boolean;
    filesWithCoverage: number;
  } {
    return {
      totalTestFiles: this.testFiles.size,
      hasCoverageData: this.coverageData !== null,
      filesWithCoverage: this.coverageData ? Object.keys(this.coverageData).length : 0,
    };
  }
}

export function createTestMapper(
  rootDir: string,
  graphBuilder: DependencyGraphBuilder,
  config?: Partial<RippleConfig>
): TestMapper {
  return new TestMapper(rootDir, graphBuilder, config);
}
