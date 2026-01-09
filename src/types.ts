/**
 * Core types for Ripple impact analysis
 */

export interface FileLocation {
  filePath: string;
  line: number;
  column: number;
}

export interface Symbol {
  name: string;
  kind: SymbolKind;
  location: FileLocation;
  exportedAs?: string; // If re-exported under different name
}

export enum SymbolKind {
  Function = 'function',
  Class = 'class',
  Variable = 'variable',
  Type = 'type',
  Interface = 'interface',
  Enum = 'enum',
  Method = 'method',
  Property = 'property',
}

export interface Dependency {
  source: FileLocation; // Where the dependency is used
  target: Symbol; // What is being depended on
  kind: DependencyKind;
}

export enum DependencyKind {
  Import = 'import',
  Call = 'call',
  Extends = 'extends',
  Implements = 'implements',
  TypeReference = 'type-reference',
  PropertyAccess = 'property-access',
}

export interface Caller {
  location: FileLocation;
  symbol: Symbol;
  context: string; // Surrounding code snippet
  isTestFile: boolean;
  isCriticalPath: boolean;
}

export interface TestMapping {
  sourceFile: string;
  testFiles: string[];
  coverage: CoverageInfo | null;
}

export interface CoverageInfo {
  lines: {
    total: number;
    covered: number;
    percentage: number;
  };
  branches: {
    total: number;
    covered: number;
    percentage: number;
  };
}

export interface ImpactAnalysis {
  target: Symbol;
  directCallers: Caller[];
  transitiveCallers: Caller[];
  affectedTests: TestMapping[];
  untestedCallers: Caller[];
  riskScore: RiskScore;
  summary: ImpactSummary;
}

export interface RiskScore {
  value: number; // 0-10
  level: RiskLevel;
  factors: RiskFactor[];
}

export enum RiskLevel {
  Low = 'LOW',
  Medium = 'MEDIUM',
  High = 'HIGH',
  Critical = 'CRITICAL',
}

export interface RiskFactor {
  name: string;
  weight: number;
  description: string;
  value: number;
}

export interface ImpactSummary {
  totalCallers: number;
  testedCallers: number;
  untestedCallers: number;
  criticalPathCallers: number;
  filesAffected: number;
  recommendation: string;
}

export interface RippleConfig {
  // Paths to analyze
  includePaths: string[];
  excludePaths: string[];

  // Test file patterns
  testPatterns: string[];

  // Risk thresholds
  riskThresholds: {
    low: number;
    medium: number;
    high: number;
  };

  // Critical path markers
  criticalPathPatterns: string[];

  // Sensitivity
  sensitivity: 'low' | 'medium' | 'high';

  // Cache settings
  cacheEnabled: boolean;
  cachePath: string;
}

export const DEFAULT_CONFIG: RippleConfig = {
  includePaths: ['src/**/*.ts', 'src/**/*.tsx', 'src/**/*.js', 'src/**/*.jsx'],
  excludePaths: ['node_modules/**', 'dist/**', 'build/**', '**/*.d.ts'],
  testPatterns: [
    '**/*.test.ts',
    '**/*.test.tsx',
    '**/*.spec.ts',
    '**/*.spec.tsx',
    '**/__tests__/**',
    '**/tests/**',
  ],
  riskThresholds: {
    low: 3,
    medium: 5,
    high: 7,
  },
  criticalPathPatterns: [
    '**/auth/**',
    '**/payment/**',
    '**/billing/**',
    '**/security/**',
    '**/admin/**',
  ],
  sensitivity: 'medium',
  cacheEnabled: true,
  cachePath: '.ripple-cache',
};

export interface DependencyGraph {
  nodes: Map<string, GraphNode>;
  edges: Map<string, Set<string>>; // from -> to[]
  reverseEdges: Map<string, Set<string>>; // to -> from[]
}

export interface GraphNode {
  filePath: string;
  symbols: Symbol[];
  imports: ImportInfo[];
  exports: ExportInfo[];
  lastModified: number;
}

export interface ImportInfo {
  source: string; // The module being imported from
  specifiers: ImportSpecifier[];
  location: FileLocation;
}

export interface ImportSpecifier {
  imported: string; // Original name
  local: string; // Local binding name
  isDefault: boolean;
  isNamespace: boolean;
}

export interface ExportInfo {
  name: string;
  kind: SymbolKind;
  location: FileLocation;
  isDefault: boolean;
}

// Events for hooks
export interface RippleEvent {
  type: 'analysis-start' | 'analysis-complete' | 'risk-warning' | 'edit-blocked';
  data: unknown;
  timestamp: number;
}

export interface AnalysisResult {
  success: boolean;
  analysis: ImpactAnalysis | null;
  errors: string[];
  duration: number;
}
