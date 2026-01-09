/**
 * Claude Code Integration Hooks
 * Integrates Ripple analysis into Claude Code's workflow
 */

import { Ripple } from '../index.js';
import { ImpactAnalysis, RiskLevel } from '../types.js';

export interface HookConfig {
  enabled: boolean;
  autoAnalyze: boolean;
  blockOnHighRisk: boolean;
  showAnalysisUI: boolean;
  riskThreshold: RiskLevel;
}

export const DEFAULT_HOOK_CONFIG: HookConfig = {
  enabled: true,
  autoAnalyze: true,
  blockOnHighRisk: false,
  showAnalysisUI: true,
  riskThreshold: RiskLevel.High,
};

export interface PreEditHookResult {
  proceed: boolean;
  analysis: ImpactAnalysis | null;
  warnings: string[];
  requiresConfirmation: boolean;
}

export interface PostEditHookResult {
  success: boolean;
  analysis: ImpactAnalysis | null;
  suggestedActions: string[];
}

/**
 * Claude Code Hook Manager
 * Manages integration between Ripple and Claude Code
 */
export class ClaudeCodeHooks {
  private ripple: Ripple;
  private config: HookConfig;
  private analysisCache: Map<string, ImpactAnalysis> = new Map();

  constructor(rootDir: string, config: Partial<HookConfig> = {}) {
    this.config = { ...DEFAULT_HOOK_CONFIG, ...config };
    this.ripple = new Ripple(rootDir);
  }

  /**
   * Initialize the hooks
   */
  async initialize(): Promise<void> {
    if (!this.config.enabled) {
      return;
    }
    await this.ripple.initialize();
  }

  /**
   * Pre-edit hook - called before Claude Code makes an edit
   * Returns analysis and whether to proceed
   */
  async preEditHook(filePath: string): Promise<PreEditHookResult> {
    if (!this.config.enabled || !this.config.autoAnalyze) {
      return {
        proceed: true,
        analysis: null,
        warnings: [],
        requiresConfirmation: false,
      };
    }

    try {
      const analysis = await this.ripple.analyzeFile(filePath);
      this.analysisCache.set(filePath, analysis);

      const warnings: string[] = [];
      let requiresConfirmation = false;

      // Check risk level
      if (
        analysis.riskScore.level === RiskLevel.Critical ||
        analysis.riskScore.level === RiskLevel.High
      ) {
        warnings.push(
          `High risk change: ${analysis.summary.totalCallers} callers affected`
        );
        requiresConfirmation = true;
      }

      // Check for untested callers
      if (analysis.untestedCallers.length > 0) {
        warnings.push(
          `${analysis.untestedCallers.length} callers have no test coverage`
        );
      }

      // Check for critical path involvement
      if (analysis.summary.criticalPathCallers > 0) {
        warnings.push(
          `${analysis.summary.criticalPathCallers} callers are in critical paths`
        );
        requiresConfirmation = true;
      }

      // Determine if we should proceed
      const proceed =
        !this.config.blockOnHighRisk ||
        this.isRiskAcceptable(analysis.riskScore.level);

      return {
        proceed,
        analysis,
        warnings,
        requiresConfirmation,
      };
    } catch (error) {
      // If analysis fails, allow the edit but warn
      return {
        proceed: true,
        analysis: null,
        warnings: [`Analysis failed: ${(error as Error).message}`],
        requiresConfirmation: false,
      };
    }
  }

  /**
   * Post-edit hook - called after Claude Code makes an edit
   * Returns suggested follow-up actions
   */
  async postEditHook(filePath: string): Promise<PostEditHookResult> {
    if (!this.config.enabled) {
      return {
        success: true,
        analysis: null,
        suggestedActions: [],
      };
    }

    try {
      // Update the graph for the changed file
      await this.ripple.updateGraph([filePath]);

      // Re-analyze to see the new state
      const analysis = await this.ripple.analyzeFile(filePath);
      const previousAnalysis = this.analysisCache.get(filePath);

      const suggestedActions: string[] = [];

      // Compare with previous analysis if available
      if (previousAnalysis) {
        const riskDelta =
          analysis.riskScore.value - previousAnalysis.riskScore.value;
        if (riskDelta > 1) {
          suggestedActions.push(
            `Risk increased by ${riskDelta.toFixed(1)} points. Consider reviewing.`
          );
        }
      }

      // Suggest tests if coverage is low
      if (analysis.summary.untestedCallers > 0) {
        suggestedActions.push(
          `Consider adding tests for ${analysis.summary.untestedCallers} untested callers`
        );
      }

      // Suggest reviewing critical paths
      if (analysis.summary.criticalPathCallers > 0) {
        suggestedActions.push(
          `Review ${analysis.summary.criticalPathCallers} critical path callers`
        );
      }

      return {
        success: true,
        analysis,
        suggestedActions,
      };
    } catch (error) {
      return {
        success: false,
        analysis: null,
        suggestedActions: [`Post-edit analysis failed: ${(error as Error).message}`],
      };
    }
  }

  /**
   * Format analysis for Claude Code UI
   */
  formatForUI(analysis: ImpactAnalysis): string {
    const lines: string[] = [];

    // Header with risk indicator
    const riskEmoji = this.getRiskEmoji(analysis.riskScore.level);
    lines.push(`┌─ RIPPLE ANALYSIS ─────────────────────────────┐`);
    lines.push(`│ ${riskEmoji} Risk Score: ${analysis.riskScore.value}/10 (${analysis.riskScore.level})`);
    lines.push(`├───────────────────────────────────────────────┤`);

    // Summary stats
    lines.push(`│ Direct Callers: ${analysis.directCallers.length}`);
    lines.push(`│ Transitive Dependents: ${analysis.transitiveCallers.length}`);
    lines.push(`│ Test Coverage: ${analysis.summary.testedCallers}/${analysis.summary.totalCallers} callers tested`);

    // Untested callers
    if (analysis.untestedCallers.length > 0) {
      lines.push(`│`);
      lines.push(`│ ⚠️  Untested Callers:`);
      const toShow = analysis.untestedCallers.slice(0, 4);
      for (const caller of toShow) {
        const shortPath = caller.location.filePath.split('/').slice(-2).join('/');
        lines.push(`│   - ${shortPath}:${caller.location.line}`);
      }
      if (analysis.untestedCallers.length > 4) {
        lines.push(`│   ... and ${analysis.untestedCallers.length - 4} more`);
      }
    }

    // Critical paths
    const criticalCallers = [...analysis.directCallers, ...analysis.transitiveCallers].filter(
      (c) => c.isCriticalPath
    );
    if (criticalCallers.length > 0) {
      lines.push(`│`);
      lines.push(`│ 🔴 Critical Path Callers:`);
      const toShow = criticalCallers.slice(0, 3);
      for (const caller of toShow) {
        const shortPath = caller.location.filePath.split('/').slice(-2).join('/');
        lines.push(`│   - ${shortPath}:${caller.location.line}`);
      }
    }

    lines.push(`└───────────────────────────────────────────────┘`);

    return lines.join('\n');
  }

  /**
   * Get compact summary for inline display
   */
  getCompactSummary(analysis: ImpactAnalysis): string {
    const riskEmoji = this.getRiskEmoji(analysis.riskScore.level);
    return `${riskEmoji} ${analysis.riskScore.level} risk | ${analysis.summary.totalCallers} callers | ${analysis.summary.untestedCallers} untested`;
  }

  /**
   * Check if user confirmation is needed
   */
  needsConfirmation(analysis: ImpactAnalysis): boolean {
    return (
      analysis.riskScore.level === RiskLevel.Critical ||
      analysis.riskScore.level === RiskLevel.High ||
      analysis.summary.criticalPathCallers > 0
    );
  }

  /**
   * Generate confirmation prompt
   */
  getConfirmationPrompt(analysis: ImpactAnalysis): string {
    const warnings: string[] = [];

    if (analysis.riskScore.level === RiskLevel.Critical) {
      warnings.push(`CRITICAL RISK: This change affects ${analysis.summary.totalCallers} callers`);
    } else if (analysis.riskScore.level === RiskLevel.High) {
      warnings.push(`HIGH RISK: This change has significant impact`);
    }

    if (analysis.untestedCallers.length > 0) {
      warnings.push(`${analysis.untestedCallers.length} callers lack test coverage`);
    }

    if (analysis.summary.criticalPathCallers > 0) {
      warnings.push(`${analysis.summary.criticalPathCallers} callers are in critical paths (auth, payment, etc.)`);
    }

    return `
${this.formatForUI(analysis)}

⚠️  ${warnings.join('\n⚠️  ')}

Options:
1. Proceed with the change
2. Proceed and generate tests for untested callers
3. Abort and discuss

What would you like to do?`.trim();
  }

  /**
   * Check if risk level is acceptable based on config
   */
  private isRiskAcceptable(level: RiskLevel): boolean {
    const levels = [RiskLevel.Low, RiskLevel.Medium, RiskLevel.High, RiskLevel.Critical];
    const configIndex = levels.indexOf(this.config.riskThreshold);
    const currentIndex = levels.indexOf(level);
    return currentIndex <= configIndex;
  }

  /**
   * Get emoji for risk level
   */
  private getRiskEmoji(level: RiskLevel): string {
    switch (level) {
      case RiskLevel.Critical:
        return '🔴';
      case RiskLevel.High:
        return '🟠';
      case RiskLevel.Medium:
        return '🟡';
      case RiskLevel.Low:
        return '🟢';
      default:
        return '⚪';
    }
  }
}

/**
 * Create hooks instance
 */
export function createClaudeCodeHooks(
  rootDir: string,
  config?: Partial<HookConfig>
): ClaudeCodeHooks {
  return new ClaudeCodeHooks(rootDir, config);
}

/**
 * Express the analysis as a decision for Claude Code
 */
export function shouldProceedWithEdit(analysis: ImpactAnalysis): {
  proceed: boolean;
  reason: string;
} {
  if (analysis.riskScore.level === RiskLevel.Critical) {
    return {
      proceed: false,
      reason: `Critical risk: ${analysis.summary.recommendation}`,
    };
  }

  if (analysis.riskScore.level === RiskLevel.High && analysis.summary.untestedCallers > 5) {
    return {
      proceed: false,
      reason: `High risk with ${analysis.summary.untestedCallers} untested callers. Consider adding tests first.`,
    };
  }

  return {
    proceed: true,
    reason: analysis.summary.recommendation,
  };
}
