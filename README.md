# Ripple

**Impact analysis plugin for Claude Code — See the blast radius before you edit**

Ripple analyzes your codebase to show you exactly what will be affected before you make changes. It prevents regressions by revealing callers, test coverage gaps, and critical path dependencies.

## Installation

```bash
npm install ripple-claude-plugin
```

## Quick Start

### CLI Usage

```bash
# Analyze impact of changing a file
ripple analyze src/services/auth.ts

# Quick risk check
ripple risk src/api/users.ts

# Analyze renaming a symbol
ripple rename getUserById fetchUserById --file src/services/user.ts

# View dependency statistics
ripple stats
```

### Programmatic Usage

```typescript
import { Ripple } from 'ripple-claude-plugin';

const ripple = new Ripple(process.cwd());
await ripple.initialize();

// Analyze a file
const analysis = await ripple.analyzeFile('src/services/auth.ts');
console.log(`Risk: ${analysis.riskScore.level}`);
console.log(`Callers: ${analysis.summary.totalCallers}`);
console.log(`Untested: ${analysis.summary.untestedCallers}`);

// Quick risk check
const risk = await ripple.quickRiskCheck('src/api/users.ts');
if (risk.riskLevel === 'HIGH') {
  console.log('Careful! This file has many dependents.');
}
```

## Claude Code Integration

Ripple integrates with Claude Code to show impact analysis before edits:

```typescript
import { createClaudeCodeHooks } from 'ripple-claude-plugin/hooks/claude-code';

const hooks = createClaudeCodeHooks(process.cwd());
await hooks.initialize();

// Before Claude edits a file
const result = await hooks.preEditHook('src/services/auth.ts');

if (result.requiresConfirmation) {
  console.log(hooks.formatForUI(result.analysis));
  // Show confirmation dialog
}

// After edit
const postResult = await hooks.postEditHook('src/services/auth.ts');
console.log('Suggested actions:', postResult.suggestedActions);
```

## Analysis Output

```
═══════════════════════════════════════════════════════════════
                      RIPPLE ANALYSIS
═══════════════════════════════════════════════════════════════

Target: auth.ts
Location: src/services/auth.ts

┌─ RISK ASSESSMENT ────────────────────────────────────────────┐
│ 🟠 Risk Score: 6.2/10 (HIGH)                                  │
│                                                               │
│ Factors:                                                      │
│   Caller Count:    ████████░░ 7.5                            │
│   Untested Callers: ██████░░░░ 6.0                           │
│   Critical Path:   ████████░░ 8.0                            │
│   Test Coverage:   ████░░░░░░ 4.0                            │
└───────────────────────────────────────────────────────────────┘

┌─ IMPACT SUMMARY ─────────────────────────────────────────────┐
│ Total Callers: 23                                             │
│   ├─ Direct: 8                                                │
│   └─ Transitive: 15                                           │
│                                                               │
│ Test Coverage: 18/23 callers tested                           │
│ Untested Callers: 5                                           │
│ Critical Path Callers: 3                                      │
│ Files Affected: 19                                            │
└───────────────────────────────────────────────────────────────┘

⚠️  Untested Callers:
  • src/api/admin.ts:47 [CRITICAL]
  • src/services/billing.ts:89
  • src/workers/sync.ts:23

───────────────────────────────────────────────────────────────
Recommendation:
  HIGH RISK: This change has significant impact. Review all
  affected files carefully.
```

## Configuration

Create a `.ripplerc.json` in your project root:

```json
{
  "includePaths": ["src/**/*.ts", "src/**/*.tsx"],
  "excludePaths": ["node_modules/**", "dist/**", "**/*.d.ts"],
  "testPatterns": ["**/*.test.ts", "**/*.spec.ts", "**/__tests__/**"],
  "criticalPathPatterns": [
    "**/auth/**",
    "**/payment/**",
    "**/billing/**"
  ],
  "riskThresholds": {
    "low": 3,
    "medium": 5,
    "high": 7
  },
  "sensitivity": "medium",
  "cacheEnabled": true
}
```

## Risk Scoring

Ripple calculates risk based on multiple factors:

| Factor | Weight | Description |
|--------|--------|-------------|
| Caller Count | 25% | Number of files that depend on this code |
| Untested Ratio | 30% | Percentage of callers without test coverage |
| Critical Path | 25% | Involvement in auth, payment, security paths |
| Test Coverage | 15% | Coverage of the file being changed |
| Transitive Depth | 5% | How deep the dependency chain goes |

Risk levels:
- 🟢 **LOW** (0-3): Safe to proceed
- 🟡 **MEDIUM** (3-5): Review recommended
- 🟠 **HIGH** (5-7): Careful review required
- 🔴 **CRITICAL** (7-10): High chance of regression

## API Reference

### `Ripple`

Main class for impact analysis.

```typescript
class Ripple {
  constructor(rootDir: string, config?: Partial<RippleConfig>);

  initialize(options?: RippleInitOptions): Promise<void>;
  analyzeFile(filePath: string, options?: ImpactOptions): Promise<ImpactAnalysis>;
  analyzeSymbol(symbolName: string, filePath: string, options?: ImpactOptions): Promise<ImpactAnalysis>;
  analyzeRename(oldName: string, newName: string, filePath: string): Promise<ImpactAnalysis & { renameLocations: FileLocation[] }>;
  quickRiskCheck(filePath: string): Promise<{ riskLevel: string; callerCount: number; hasTests: boolean }>;
  updateGraph(changedFiles: string[]): Promise<void>;
  getStats(): { graph: GraphStats; tests: TestStats };
  getDependents(filePath: string): string[];
  getDependencies(filePath: string): string[];
}
```

### `ClaudeCodeHooks`

Integration hooks for Claude Code.

```typescript
class ClaudeCodeHooks {
  constructor(rootDir: string, config?: Partial<HookConfig>);

  initialize(): Promise<void>;
  preEditHook(filePath: string): Promise<PreEditHookResult>;
  postEditHook(filePath: string): Promise<PostEditHookResult>;
  formatForUI(analysis: ImpactAnalysis): string;
  getCompactSummary(analysis: ImpactAnalysis): string;
  needsConfirmation(analysis: ImpactAnalysis): boolean;
  getConfirmationPrompt(analysis: ImpactAnalysis): string;
}
```

## License

MIT
