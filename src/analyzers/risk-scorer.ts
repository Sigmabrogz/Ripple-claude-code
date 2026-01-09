/**
 * Risk Scorer - Calculates risk scores based on multiple factors
 * Provides weighted scoring with configurable thresholds
 */

import * as path from 'path';
import { minimatch } from 'minimatch';
import {
  RiskScore,
  RiskLevel,
  RiskFactor,
  Caller,
  TestMapping,
  RippleConfig,
  DEFAULT_CONFIG,
} from '../types.js';

export interface RiskInput {
  directCallers: Caller[];
  transitiveCallers: Caller[];
  untestedCallers: Caller[];
  affectedTests: TestMapping[];
  filePath: string;
}

export interface RiskWeights {
  callerCount: number;
  untestedRatio: number;
  criticalPath: number;
  testCoverage: number;
  transitiveDepth: number;
}

const DEFAULT_WEIGHTS: RiskWeights = {
  callerCount: 0.25,
  untestedRatio: 0.30,
  criticalPath: 0.25,
  testCoverage: 0.15,
  transitiveDepth: 0.05,
};

export class RiskScorer {
  private config: RippleConfig;
  private weights: RiskWeights;

  constructor(
    config: Partial<RippleConfig> = {},
    weights: Partial<RiskWeights> = {}
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.weights = { ...DEFAULT_WEIGHTS, ...weights };
  }

  /**
   * Calculate the overall risk score for a change
   */
  calculateRisk(input: RiskInput): RiskScore {
    const factors: RiskFactor[] = [];

    // Factor 1: Number of callers
    const callerFactor = this.calculateCallerFactor(input);
    factors.push(callerFactor);

    // Factor 2: Ratio of untested callers
    const untestedFactor = this.calculateUntestedFactor(input);
    factors.push(untestedFactor);

    // Factor 3: Critical path involvement
    const criticalPathFactor = this.calculateCriticalPathFactor(input);
    factors.push(criticalPathFactor);

    // Factor 4: Test coverage of the file itself
    const testCoverageFactor = this.calculateTestCoverageFactor(input);
    factors.push(testCoverageFactor);

    // Factor 5: Transitive dependency depth
    const transitiveFactor = this.calculateTransitiveFactor(input);
    factors.push(transitiveFactor);

    // Calculate weighted sum
    const weightedSum = factors.reduce((sum, factor) => {
      return sum + factor.value * factor.weight;
    }, 0);

    // Normalize to 0-10 scale
    const normalizedValue = Math.min(10, Math.max(0, weightedSum));

    // Determine risk level
    const level = this.determineRiskLevel(normalizedValue);

    return {
      value: Math.round(normalizedValue * 10) / 10,
      level,
      factors,
    };
  }

  /**
   * Calculate factor based on number of callers
   */
  private calculateCallerFactor(input: RiskInput): RiskFactor {
    const totalCallers = input.directCallers.length + input.transitiveCallers.length;

    // Scoring: 0 callers = 0, 1-5 = low, 6-15 = medium, 16-30 = high, 30+ = very high
    let value: number;
    if (totalCallers === 0) {
      value = 0;
    } else if (totalCallers <= 5) {
      value = 2 + (totalCallers / 5) * 2;
    } else if (totalCallers <= 15) {
      value = 4 + ((totalCallers - 5) / 10) * 2;
    } else if (totalCallers <= 30) {
      value = 6 + ((totalCallers - 15) / 15) * 2;
    } else {
      value = 8 + Math.min(2, (totalCallers - 30) / 50);
    }

    return {
      name: 'Caller Count',
      weight: this.weights.callerCount,
      description: `${totalCallers} total callers (${input.directCallers.length} direct, ${input.transitiveCallers.length} transitive)`,
      value,
    };
  }

  /**
   * Calculate factor based on untested caller ratio
   */
  private calculateUntestedFactor(input: RiskInput): RiskFactor {
    const totalCallers = input.directCallers.length + input.transitiveCallers.length;
    const untestedCount = input.untestedCallers.length;

    if (totalCallers === 0) {
      return {
        name: 'Untested Callers',
        weight: this.weights.untestedRatio,
        description: 'No callers to evaluate',
        value: 0,
      };
    }

    const ratio = untestedCount / totalCallers;
    const value = ratio * 10;

    return {
      name: 'Untested Callers',
      weight: this.weights.untestedRatio,
      description: `${untestedCount}/${totalCallers} callers lack test coverage (${Math.round(ratio * 100)}%)`,
      value,
    };
  }

  /**
   * Calculate factor based on critical path involvement
   */
  private calculateCriticalPathFactor(input: RiskInput): RiskFactor {
    const allCallers = [...input.directCallers, ...input.transitiveCallers];
    const criticalPathCallers = allCallers.filter((c) => c.isCriticalPath);

    // Check if the file itself is in a critical path
    const fileInCriticalPath = this.isInCriticalPath(input.filePath);

    let value = 0;

    // File itself in critical path: high base risk
    if (fileInCriticalPath) {
      value += 5;
    }

    // Each critical path caller adds to risk
    if (criticalPathCallers.length > 0) {
      value += Math.min(5, criticalPathCallers.length);
    }

    const criticalPaths = fileInCriticalPath
      ? ['Target file in critical path']
      : [];
    if (criticalPathCallers.length > 0) {
      criticalPaths.push(`${criticalPathCallers.length} callers in critical paths`);
    }

    return {
      name: 'Critical Path',
      weight: this.weights.criticalPath,
      description:
        criticalPaths.length > 0
          ? criticalPaths.join('; ')
          : 'No critical path involvement',
      value,
    };
  }

  /**
   * Calculate factor based on test coverage of the target file
   */
  private calculateTestCoverageFactor(input: RiskInput): RiskFactor {
    // Find the test mapping for the target file
    const targetTests = input.affectedTests.find(
      (t) => t.sourceFile === input.filePath
    );

    if (!targetTests) {
      return {
        name: 'Test Coverage',
        weight: this.weights.testCoverage,
        description: 'No test mapping found',
        value: 8, // High risk when we can't determine coverage
      };
    }

    // No tests at all
    if (targetTests.testFiles.length === 0) {
      return {
        name: 'Test Coverage',
        weight: this.weights.testCoverage,
        description: 'No test files found for this file',
        value: 10,
      };
    }

    // Has tests but no coverage data
    if (!targetTests.coverage) {
      return {
        name: 'Test Coverage',
        weight: this.weights.testCoverage,
        description: `${targetTests.testFiles.length} test file(s) found (no coverage data)`,
        value: 3, // Lower risk - tests exist
      };
    }

    // Calculate inverse of coverage (higher coverage = lower risk)
    const coverage = targetTests.coverage;
    const avgCoverage = (coverage.lines.percentage + coverage.branches.percentage) / 2;
    const value = 10 - (avgCoverage / 10);

    return {
      name: 'Test Coverage',
      weight: this.weights.testCoverage,
      description: `${Math.round(coverage.lines.percentage)}% line coverage, ${Math.round(coverage.branches.percentage)}% branch coverage`,
      value,
    };
  }

  /**
   * Calculate factor based on transitive dependency depth
   */
  private calculateTransitiveFactor(input: RiskInput): RiskFactor {
    const transitiveCount = input.transitiveCallers.length;

    // More transitive dependencies = harder to track impact
    let value: number;
    if (transitiveCount === 0) {
      value = 0;
    } else if (transitiveCount <= 5) {
      value = 2;
    } else if (transitiveCount <= 15) {
      value = 4;
    } else if (transitiveCount <= 30) {
      value = 6;
    } else {
      value = 8;
    }

    return {
      name: 'Transitive Impact',
      weight: this.weights.transitiveDepth,
      description: `${transitiveCount} transitive dependencies`,
      value,
    };
  }

  /**
   * Check if a file is in a critical path
   */
  private isInCriticalPath(filePath: string): boolean {
    for (const pattern of this.config.criticalPathPatterns) {
      if (minimatch(filePath, pattern)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Determine risk level from score
   */
  private determineRiskLevel(score: number): RiskLevel {
    if (score >= this.config.riskThresholds.high) {
      return RiskLevel.Critical;
    } else if (score >= this.config.riskThresholds.medium) {
      return RiskLevel.High;
    } else if (score >= this.config.riskThresholds.low) {
      return RiskLevel.Medium;
    } else {
      return RiskLevel.Low;
    }
  }

  /**
   * Get a human-readable explanation of the risk score
   */
  explainRisk(riskScore: RiskScore): string {
    const lines: string[] = [
      `Risk Score: ${riskScore.value}/10 (${riskScore.level})`,
      '',
      'Contributing Factors:',
    ];

    // Sort factors by contribution (value * weight)
    const sortedFactors = [...riskScore.factors].sort(
      (a, b) => b.value * b.weight - a.value * a.weight
    );

    for (const factor of sortedFactors) {
      const contribution = (factor.value * factor.weight).toFixed(1);
      const bar = this.createBar(factor.value, 10);
      lines.push(`  ${factor.name}: ${bar} ${factor.value.toFixed(1)}/10 (weight: ${(factor.weight * 100).toFixed(0)}%)`);
      lines.push(`    ${factor.description}`);
    }

    return lines.join('\n');
  }

  /**
   * Create a visual bar for scores
   */
  private createBar(value: number, max: number): string {
    const filled = Math.round((value / max) * 10);
    const empty = 10 - filled;
    return '█'.repeat(filled) + '░'.repeat(empty);
  }

  /**
   * Compare two risk scores
   */
  compareRisk(before: RiskScore, after: RiskScore): {
    delta: number;
    improved: boolean;
    analysis: string;
  } {
    const delta = after.value - before.value;
    const improved = delta < 0;

    let analysis: string;
    if (Math.abs(delta) < 0.5) {
      analysis = 'Risk level unchanged';
    } else if (improved) {
      analysis = `Risk decreased by ${Math.abs(delta).toFixed(1)} points`;
    } else {
      analysis = `Risk increased by ${delta.toFixed(1)} points`;
    }

    return { delta, improved, analysis };
  }

  /**
   * Suggest mitigations based on risk factors
   */
  suggestMitigations(riskScore: RiskScore): string[] {
    const suggestions: string[] = [];

    for (const factor of riskScore.factors) {
      if (factor.value >= 6) {
        switch (factor.name) {
          case 'Caller Count':
            suggestions.push(
              'Consider breaking this change into smaller, incremental updates'
            );
            suggestions.push(
              'Review each caller to ensure the change is compatible'
            );
            break;

          case 'Untested Callers':
            suggestions.push(
              'Add tests for uncovered callers before making this change'
            );
            suggestions.push(
              'Consider adding integration tests to catch cross-file regressions'
            );
            break;

          case 'Critical Path':
            suggestions.push(
              'Extra review recommended for changes in critical paths'
            );
            suggestions.push(
              'Consider feature flag or staged rollout for this change'
            );
            break;

          case 'Test Coverage':
            suggestions.push(
              'Add unit tests for the changed file before proceeding'
            );
            suggestions.push(
              'Run existing tests and verify they exercise the changed code'
            );
            break;

          case 'Transitive Impact':
            suggestions.push(
              'Map out the full dependency chain before making changes'
            );
            suggestions.push(
              'Consider the ripple effect on indirect consumers'
            );
            break;
        }
      }
    }

    // Deduplicate
    return [...new Set(suggestions)];
  }
}

export function createRiskScorer(
  config?: Partial<RippleConfig>,
  weights?: Partial<RiskWeights>
): RiskScorer {
  return new RiskScorer(config, weights);
}
