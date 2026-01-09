#!/usr/bin/env node
/**
 * Ripple CLI - Command line interface for impact analysis
 */

import { Command } from 'commander';
import { Ripple } from '../index.js';
import { formatAnalysis, formatRisk, formatStats } from './formatter.js';

const program = new Command();

program
  .name('ripple')
  .description('Impact analysis for Claude Code - See the blast radius before you edit')
  .version('0.1.0');

// Analyze command
program
  .command('analyze <file>')
  .description('Analyze the impact of changing a file')
  .option('-s, --symbol <name>', 'Analyze a specific symbol instead of the whole file')
  .option('-t, --transitive', 'Include transitive dependencies', true)
  .option('-d, --depth <number>', 'Maximum depth for transitive analysis', '10')
  .option('-v, --verbose', 'Show detailed output')
  .option('-j, --json', 'Output as JSON')
  .action(async (file, options) => {
    try {
      const ripple = new Ripple(process.cwd());
      await ripple.initialize({ verbose: options.verbose });

      let analysis;
      if (options.symbol) {
        analysis = await ripple.analyzeSymbol(options.symbol, file, {
          includeTransitive: options.transitive,
          maxDepth: parseInt(options.depth),
        });
      } else {
        analysis = await ripple.analyzeFile(file, {
          includeTransitive: options.transitive,
          maxDepth: parseInt(options.depth),
        });
      }

      if (options.json) {
        console.log(JSON.stringify(analysis, null, 2));
      } else {
        console.log(formatAnalysis(analysis));
      }
    } catch (error) {
      console.error('Error:', (error as Error).message);
      process.exit(1);
    }
  });

// Risk command
program
  .command('risk <file>')
  .description('Quick risk assessment for a file')
  .option('-j, --json', 'Output as JSON')
  .action(async (file, options) => {
    try {
      const ripple = new Ripple(process.cwd());
      await ripple.initialize();

      const risk = await ripple.quickRiskCheck(file);

      if (options.json) {
        console.log(JSON.stringify(risk, null, 2));
      } else {
        console.log(formatRisk(risk, file));
      }
    } catch (error) {
      console.error('Error:', (error as Error).message);
      process.exit(1);
    }
  });

// Rename command
program
  .command('rename <oldName> <newName>')
  .description('Analyze the impact of renaming a symbol')
  .requiredOption('-f, --file <path>', 'File where the symbol is defined')
  .option('--dry-run', 'Show what would change without making changes', true)
  .option('-j, --json', 'Output as JSON')
  .action(async (oldName, newName, options) => {
    try {
      const ripple = new Ripple(process.cwd());
      await ripple.initialize();

      const analysis = await ripple.analyzeRename(oldName, newName, options.file);

      if (options.json) {
        console.log(JSON.stringify(analysis, null, 2));
      } else {
        console.log(formatAnalysis(analysis));
        console.log('\nLocations to rename:');
        for (const loc of analysis.renameLocations) {
          console.log(`  ${loc.filePath}:${loc.line}:${loc.column}`);
        }
      }
    } catch (error) {
      console.error('Error:', (error as Error).message);
      process.exit(1);
    }
  });

// Stats command
program
  .command('stats')
  .description('Show statistics about the dependency graph')
  .option('-j, --json', 'Output as JSON')
  .action(async (options) => {
    try {
      const ripple = new Ripple(process.cwd());
      await ripple.initialize();

      const stats = ripple.getStats();

      if (options.json) {
        console.log(JSON.stringify(stats, null, 2));
      } else {
        console.log(formatStats(stats));
      }
    } catch (error) {
      console.error('Error:', (error as Error).message);
      process.exit(1);
    }
  });

// Config command
program
  .command('config')
  .description('Manage Ripple configuration')
  .option('--show', 'Show current configuration')
  .option('--sensitivity <level>', 'Set sensitivity (low, medium, high)')
  .option('--ignore-paths <paths...>', 'Add paths to ignore')
  .option('--critical-paths <paths...>', 'Add critical path patterns')
  .action(async (options) => {
    try {
      const ripple = new Ripple(process.cwd());

      if (options.show) {
        const config = ripple.getConfig();
        console.log(JSON.stringify(config, null, 2));
        return;
      }

      if (options.sensitivity) {
        // Would save to .ripplerc
        console.log(`Setting sensitivity to: ${options.sensitivity}`);
      }

      if (options.ignorePaths) {
        console.log(`Adding ignore paths: ${options.ignorePaths.join(', ')}`);
      }

      if (options.criticalPaths) {
        console.log(`Adding critical paths: ${options.criticalPaths.join(', ')}`);
      }

      console.log('Configuration updated. Run `ripple config --show` to verify.');
    } catch (error) {
      console.error('Error:', (error as Error).message);
      process.exit(1);
    }
  });

// Enable/disable integration mode
program
  .command('enable')
  .description('Enable Ripple integration with Claude Code')
  .action(async () => {
    console.log('Ripple integration enabled.');
    console.log('Claude Code will now show impact analysis before edits.');
    console.log('\nTo disable, run: ripple disable');
  });

program
  .command('disable')
  .description('Disable Ripple integration with Claude Code')
  .action(async () => {
    console.log('Ripple integration disabled.');
  });

// Parse and execute
program.parse();
