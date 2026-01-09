/**
 * Ripple Tests
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { Ripple } from '../src/index.js';
import { RiskLevel } from '../src/types.js';

describe('Ripple', () => {
  let testDir: string;
  let ripple: Ripple;

  beforeAll(async () => {
    // Create a temporary test directory with sample files
    testDir = path.join(os.tmpdir(), `ripple-test-${Date.now()}`);
    fs.mkdirSync(testDir, { recursive: true });
    fs.mkdirSync(path.join(testDir, 'src'), { recursive: true });
    fs.mkdirSync(path.join(testDir, 'src', 'services'), { recursive: true });
    fs.mkdirSync(path.join(testDir, 'src', 'api'), { recursive: true });
    fs.mkdirSync(path.join(testDir, 'tests'), { recursive: true });

    // Create sample files
    fs.writeFileSync(
      path.join(testDir, 'src', 'services', 'user.ts'),
      `
export interface User {
  id: string;
  name: string;
  email: string;
}

export function getUser(id: string): User {
  return { id, name: 'Test', email: 'test@test.com' };
}

export function updateUser(id: string, data: Partial<User>): User {
  const user = getUser(id);
  return { ...user, ...data };
}
`
    );

    fs.writeFileSync(
      path.join(testDir, 'src', 'api', 'users.ts'),
      `
import { getUser, updateUser, User } from '../services/user';

export function handleGetUser(req: { params: { id: string } }): User {
  return getUser(req.params.id);
}

export function handleUpdateUser(req: { params: { id: string }; body: Partial<User> }): User {
  return updateUser(req.params.id, req.body);
}
`
    );

    fs.writeFileSync(
      path.join(testDir, 'src', 'api', 'admin.ts'),
      `
import { getUser, User } from '../services/user';

export function getAdminUser(id: string): User & { isAdmin: true } {
  const user = getUser(id);
  return { ...user, isAdmin: true as const };
}
`
    );

    fs.writeFileSync(
      path.join(testDir, 'tests', 'user.test.ts'),
      `
import { getUser, updateUser } from '../src/services/user';

describe('User Service', () => {
  it('should get user', () => {
    const user = getUser('123');
    expect(user.id).toBe('123');
  });

  it('should update user', () => {
    const user = updateUser('123', { name: 'Updated' });
    expect(user.name).toBe('Updated');
  });
});
`
    );

    // Create tsconfig.json
    fs.writeFileSync(
      path.join(testDir, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          target: 'ES2022',
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          strict: true,
          esModuleInterop: true,
        },
        include: ['src/**/*', 'tests/**/*'],
      })
    );

    // Initialize Ripple
    ripple = new Ripple(testDir, {
      includePaths: ['src/**/*.ts'],
      testPatterns: ['tests/**/*.test.ts'],
    });
    await ripple.initialize({ verbose: false });
  });

  describe('analyzeFile', () => {
    it('should analyze a file and return impact analysis', async () => {
      const analysis = await ripple.analyzeFile('src/services/user.ts');

      expect(analysis).toBeDefined();
      expect(analysis.target).toBeDefined();
      expect(analysis.riskScore).toBeDefined();
      expect(analysis.summary).toBeDefined();
    });

    it('should detect direct callers', async () => {
      const analysis = await ripple.analyzeFile('src/services/user.ts');

      // Should find api/users.ts and api/admin.ts as callers
      expect(analysis.directCallers.length).toBeGreaterThan(0);
    });

    it('should calculate risk score', async () => {
      const analysis = await ripple.analyzeFile('src/services/user.ts');

      expect(analysis.riskScore.value).toBeGreaterThanOrEqual(0);
      expect(analysis.riskScore.value).toBeLessThanOrEqual(10);
      expect([RiskLevel.Low, RiskLevel.Medium, RiskLevel.High, RiskLevel.Critical]).toContain(
        analysis.riskScore.level
      );
    });

    it('should identify test files', async () => {
      const analysis = await ripple.analyzeFile('src/services/user.ts');

      expect(analysis.affectedTests).toBeDefined();
      expect(analysis.affectedTests.length).toBeGreaterThan(0);
    });
  });

  describe('quickRiskCheck', () => {
    it('should return quick risk assessment', async () => {
      const risk = await ripple.quickRiskCheck('src/services/user.ts');

      expect(risk).toBeDefined();
      expect(risk.riskLevel).toBeDefined();
      expect(risk.callerCount).toBeDefined();
      expect(typeof risk.hasTests).toBe('boolean');
    });
  });

  describe('getDependents', () => {
    it('should return direct dependents', () => {
      const dependents = ripple.getDependents('src/services/user.ts');

      expect(Array.isArray(dependents)).toBe(true);
    });
  });

  describe('getDependencies', () => {
    it('should return direct dependencies', () => {
      const dependencies = ripple.getDependencies('src/api/users.ts');

      expect(Array.isArray(dependencies)).toBe(true);
    });
  });

  describe('isTestFile', () => {
    it('should correctly identify test files', () => {
      expect(ripple.isTestFile('tests/user.test.ts')).toBe(true);
      expect(ripple.isTestFile('src/services/user.ts')).toBe(false);
    });
  });

  describe('getStats', () => {
    it('should return graph and test statistics', () => {
      const stats = ripple.getStats();

      expect(stats.graph).toBeDefined();
      expect(stats.graph.totalFiles).toBeGreaterThan(0);
      expect(stats.tests).toBeDefined();
    });
  });
});

describe('RiskScorer', () => {
  it('should calculate risk factors', async () => {
    const testDir = path.join(os.tmpdir(), `ripple-risk-test-${Date.now()}`);
    fs.mkdirSync(testDir, { recursive: true });
    fs.mkdirSync(path.join(testDir, 'src'), { recursive: true });

    // Create a file with many exports
    fs.writeFileSync(
      path.join(testDir, 'src', 'utils.ts'),
      `
export const add = (a: number, b: number) => a + b;
export const subtract = (a: number, b: number) => a - b;
`
    );

    fs.writeFileSync(
      path.join(testDir, 'tsconfig.json'),
      JSON.stringify({ compilerOptions: { target: 'ES2022' } })
    );

    const ripple = new Ripple(testDir);
    await ripple.initialize();

    const analysis = await ripple.analyzeFile('src/utils.ts');

    expect(analysis.riskScore.factors).toBeDefined();
    expect(analysis.riskScore.factors.length).toBeGreaterThan(0);

    for (const factor of analysis.riskScore.factors) {
      expect(factor.name).toBeDefined();
      expect(factor.weight).toBeGreaterThan(0);
      expect(factor.value).toBeGreaterThanOrEqual(0);
    }
  });
});
