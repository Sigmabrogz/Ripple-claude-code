/**
 * CLI Formatter - Formats analysis results for terminal output
 */

import * as path from 'path';
import { ImpactAnalysis, RiskLevel, Caller } from '../types.js';

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  bgRed: '\x1b[41m',
  bgYellow: '\x1b[43m',
  bgGreen: '\x1b[42m',
};

function colorize(text: string, color: keyof typeof colors): string {
  return `${colors[color]}${text}${colors.reset}`;
}

function getRiskColor(level: RiskLevel): keyof typeof colors {
  switch (level) {
    case RiskLevel.Critical:
      return 'red';
    case RiskLevel.High:
      return 'yellow';
    case RiskLevel.Medium:
      return 'magenta';
    case RiskLevel.Low:
      return 'green';
    default:
      return 'white';
  }
}

function getRiskEmoji(level: RiskLevel): string {
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

function createBox(title: string, content: string[]): string {
  const maxWidth = Math.max(
    title.length + 4,
    ...content.map((line) => stripAnsi(line).length + 2)
  );
  const width = Math.min(maxWidth, 70);

  const topBorder = `┌─ ${title} ${'─'.repeat(Math.max(0, width - title.length - 4))}┐`;
  const bottomBorder = `└${'─'.repeat(width)}┘`;

  const lines = content.map((line) => {
    const stripped = stripAnsi(line);
    const padding = Math.max(0, width - stripped.length - 2);
    return `│ ${line}${' '.repeat(padding)} │`;
  });

  return [topBorder, ...lines, bottomBorder].join('\n');
}

function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

function formatPath(filePath: string, rootDir: string = process.cwd()): string {
  return path.relative(rootDir, filePath);
}

function formatCaller(caller: Caller, rootDir: string): string {
  const filePath = formatPath(caller.location.filePath, rootDir);
  const location = `${filePath}:${caller.location.line}`;

  let badges = '';
  if (caller.isTestFile) {
    badges += colorize(' [TEST]', 'cyan');
  }
  if (caller.isCriticalPath) {
    badges += colorize(' [CRITICAL]', 'red');
  }

  return `${location}${badges}`;
}

export function formatAnalysis(analysis: ImpactAnalysis): string {
  const rootDir = process.cwd();
  const output: string[] = [];

  // Header
  const riskEmoji = getRiskEmoji(analysis.riskScore.level);
  const riskColor = getRiskColor(analysis.riskScore.level);

  output.push('');
  output.push(colorize('═══════════════════════════════════════════════════════════════', 'dim'));
  output.push(colorize('                      RIPPLE ANALYSIS', 'bold'));
  output.push(colorize('═══════════════════════════════════════════════════════════════', 'dim'));
  output.push('');

  // Target info
  output.push(colorize('Target:', 'bold') + ` ${analysis.target.name}`);
  output.push(colorize('Location:', 'dim') + ` ${formatPath(analysis.target.location.filePath, rootDir)}`);
  output.push('');

  // Risk Score Box
  const riskContent = [
    `${riskEmoji} Risk Score: ${colorize(analysis.riskScore.value.toString(), riskColor)}/10 (${colorize(analysis.riskScore.level, riskColor)})`,
    '',
    colorize('Factors:', 'dim'),
  ];

  for (const factor of analysis.riskScore.factors) {
    const bar = createProgressBar(factor.value, 10);
    riskContent.push(`  ${factor.name}: ${bar} ${factor.value.toFixed(1)}`);
  }

  output.push(createBox('RISK ASSESSMENT', riskContent));
  output.push('');

  // Impact Summary Box
  const summaryContent = [
    `Total Callers: ${colorize(analysis.summary.totalCallers.toString(), 'bold')}`,
    `  ├─ Direct: ${analysis.directCallers.length}`,
    `  └─ Transitive: ${analysis.transitiveCallers.length}`,
    '',
    `Test Coverage: ${analysis.summary.testedCallers}/${analysis.summary.totalCallers} callers tested`,
    `Untested Callers: ${colorize(analysis.summary.untestedCallers.toString(), analysis.summary.untestedCallers > 0 ? 'yellow' : 'green')}`,
    `Critical Path Callers: ${colorize(analysis.summary.criticalPathCallers.toString(), analysis.summary.criticalPathCallers > 0 ? 'red' : 'green')}`,
    `Files Affected: ${analysis.summary.filesAffected}`,
  ];

  output.push(createBox('IMPACT SUMMARY', summaryContent));
  output.push('');

  // Direct Callers
  if (analysis.directCallers.length > 0) {
    const callerContent = analysis.directCallers.slice(0, 10).map(
      (caller) => `  ${formatCaller(caller, rootDir)}`
    );

    if (analysis.directCallers.length > 10) {
      callerContent.push(colorize(`  ... and ${analysis.directCallers.length - 10} more`, 'dim'));
    }

    output.push(colorize('Direct Callers:', 'bold'));
    output.push(callerContent.join('\n'));
    output.push('');
  }

  // Untested Callers (highlight these)
  if (analysis.untestedCallers.length > 0) {
    output.push(colorize('⚠️  Untested Callers:', 'yellow'));
    const untestedContent = analysis.untestedCallers.slice(0, 5).map(
      (caller) => `  ${colorize('•', 'yellow')} ${formatCaller(caller, rootDir)}`
    );

    if (analysis.untestedCallers.length > 5) {
      untestedContent.push(colorize(`  ... and ${analysis.untestedCallers.length - 5} more`, 'dim'));
    }

    output.push(untestedContent.join('\n'));
    output.push('');
  }

  // Test Files
  const allTestFiles = analysis.affectedTests.flatMap((t) => t.testFiles);
  if (allTestFiles.length > 0) {
    output.push(colorize('Related Test Files:', 'bold'));
    const testContent = allTestFiles.slice(0, 5).map(
      (testFile) => `  ${colorize('✓', 'green')} ${formatPath(testFile, rootDir)}`
    );

    if (allTestFiles.length > 5) {
      testContent.push(colorize(`  ... and ${allTestFiles.length - 5} more`, 'dim'));
    }

    output.push(testContent.join('\n'));
    output.push('');
  }

  // Recommendation
  output.push(colorize('───────────────────────────────────────────────────────────────', 'dim'));
  output.push(colorize('Recommendation:', 'bold'));
  output.push(`  ${analysis.summary.recommendation}`);
  output.push('');

  return output.join('\n');
}

export function formatRisk(
  risk: { riskLevel: string; callerCount: number; hasTests: boolean },
  file: string
): string {
  const output: string[] = [];

  output.push('');
  output.push(colorize('Quick Risk Check:', 'bold') + ` ${formatPath(file)}`);
  output.push('');

  const riskColor = risk.riskLevel === 'CRITICAL' || risk.riskLevel === 'HIGH'
    ? 'red'
    : risk.riskLevel === 'MEDIUM'
    ? 'yellow'
    : 'green';

  output.push(`  Risk Level: ${colorize(risk.riskLevel, riskColor)}`);
  output.push(`  Caller Count: ${risk.callerCount}`);
  output.push(`  Has Tests: ${risk.hasTests ? colorize('Yes', 'green') : colorize('No', 'red')}`);
  output.push('');

  return output.join('\n');
}

export function formatStats(stats: {
  graph: {
    totalFiles: number;
    totalEdges: number;
    averageDependencies: number;
    mostDependent: { file: string; count: number } | null;
    mostDependedOn: { file: string; count: number } | null;
  };
  tests: {
    totalTestFiles: number;
    hasCoverageData: boolean;
    filesWithCoverage: number;
  };
}): string {
  const output: string[] = [];

  output.push('');
  output.push(colorize('═══════════════════════════════════════════════════════════════', 'dim'));
  output.push(colorize('                    RIPPLE STATISTICS', 'bold'));
  output.push(colorize('═══════════════════════════════════════════════════════════════', 'dim'));
  output.push('');

  output.push(colorize('Dependency Graph:', 'bold'));
  output.push(`  Total Files: ${stats.graph.totalFiles}`);
  output.push(`  Total Edges: ${stats.graph.totalEdges}`);
  output.push(`  Avg Dependencies: ${stats.graph.averageDependencies.toFixed(1)}`);

  if (stats.graph.mostDependent) {
    output.push(`  Most Dependencies: ${formatPath(stats.graph.mostDependent.file)} (${stats.graph.mostDependent.count})`);
  }

  if (stats.graph.mostDependedOn) {
    output.push(`  Most Depended On: ${formatPath(stats.graph.mostDependedOn.file)} (${stats.graph.mostDependedOn.count})`);
  }

  output.push('');
  output.push(colorize('Test Coverage:', 'bold'));
  output.push(`  Test Files: ${stats.tests.totalTestFiles}`);
  output.push(`  Coverage Data: ${stats.tests.hasCoverageData ? colorize('Available', 'green') : colorize('Not found', 'yellow')}`);

  if (stats.tests.hasCoverageData) {
    output.push(`  Files with Coverage: ${stats.tests.filesWithCoverage}`);
  }

  output.push('');

  return output.join('\n');
}

function createProgressBar(value: number, max: number): string {
  const width = 10;
  const filled = Math.round((value / max) * width);
  const empty = width - filled;

  let bar = '';
  for (let i = 0; i < filled; i++) {
    if (i < width * 0.3) bar += colorize('█', 'green');
    else if (i < width * 0.6) bar += colorize('█', 'yellow');
    else bar += colorize('█', 'red');
  }
  bar += colorize('░'.repeat(empty), 'dim');

  return bar;
}
