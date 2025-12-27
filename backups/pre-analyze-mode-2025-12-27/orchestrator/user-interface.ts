/**
 * User Interface Module
 * Handles user confirmations and interactive prompts
 */

import readline from 'readline';
import type { BlueprintResult, OptionsResult } from '../agents/architect.js';

export class UserInterface {
  private rl: readline.Interface | null = null;

  /**
   * Initialize readline interface
   */
  private ensureReadline(): readline.Interface {
    if (!this.rl) {
      this.rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });
    }
    return this.rl;
  }

  /**
   * Close readline interface
   */
  close(): void {
    if (this.rl) {
      this.rl.close();
      this.rl = null;
    }
  }

  /**
   * Ask user to select from options
   */
  async selectOption(options: OptionsResult): Promise<string> {
    const rl = this.ensureReadline();

    console.log('\n📋 Available Options:\n');

    for (const opt of options.options) {
      console.log(`  [${opt.id}] ${opt.name} (fit: ${(opt.fit_score * 100).toFixed(0)}%)`);
      console.log(`      ${opt.description}`);
      console.log(`      ✓ Pros: ${opt.pros.join(', ')}`);
      if (opt.cons.length > 0) {
        console.log(`      ✗ Cons: ${opt.cons.join(', ')}`);
      }
      console.log('');
    }

    console.log(`💡 Recommendation: ${options.recommendation}\n`);

    return new Promise((resolve) => {
      rl.question(`Select option (${options.options.map((o: { id: string }) => o.id).join('/')}) or press Enter for recommendation: `, (answer) => {
        const selected = answer.trim().toUpperCase();

        if (!selected) {
          // Use first option (recommended)
          resolve(options.options[0].id);
        } else if (options.options.some((o: { id: string }) => o.id === selected)) {
          resolve(selected);
        } else {
          console.log('Invalid option, using recommendation');
          resolve(options.options[0].id);
        }
      });
    });
  }

  /**
   * Confirm blueprint before proceeding
   */
  async confirmBlueprint(blueprint: BlueprintResult): Promise<boolean> {
    const rl = this.ensureReadline();

    console.log('\n📐 Workflow Blueprint:\n');
    console.log(`  Name: ${blueprint.workflow_name}`);
    console.log(`  Description: ${blueprint.description}`);
    console.log(`\n  Nodes (${blueprint.nodes.length}):`);

    for (const node of blueprint.nodes) {
      console.log(`    • ${node.name}: ${node.type}`);
      console.log(`      Purpose: ${node.purpose}`);
    }

    console.log(`\n  Credentials needed:`);
    if (blueprint.credentials_needed.length === 0) {
      console.log(`    None`);
    } else {
      for (const cred of blueprint.credentials_needed) {
        console.log(`    • ${cred}`);
      }
    }

    console.log(`\n  Connections:`);
    for (const conn of blueprint.connections) {
      console.log(`    ${conn.from} → ${conn.to}`);
    }

    return new Promise((resolve) => {
      rl.question('\n✅ Proceed with this blueprint? (Y/n): ', (answer) => {
        const normalized = answer.trim().toLowerCase();
        resolve(normalized !== 'n' && normalized !== 'no');
      });
    });
  }

  /**
   * Ask yes/no question
   */
  async confirm(question: string, defaultYes: boolean = true): Promise<boolean> {
    const rl = this.ensureReadline();
    const suffix = defaultYes ? ' (Y/n): ' : ' (y/N): ';

    return new Promise((resolve) => {
      rl.question(question + suffix, (answer) => {
        const normalized = answer.trim().toLowerCase();

        if (!normalized) {
          resolve(defaultYes);
        } else {
          resolve(normalized === 'y' || normalized === 'yes');
        }
      });
    });
  }

  /**
   * Ask for text input
   */
  async ask(question: string): Promise<string> {
    const rl = this.ensureReadline();

    return new Promise((resolve) => {
      rl.question(question + ': ', (answer) => {
        resolve(answer.trim());
      });
    });
  }

  /**
   * Show progress update
   */
  showProgress(stage: string, message: string): void {
    const stages = {
      clarification: '1/6',
      research: '2/6',
      decision: '3/6',
      credentials: '4/6',
      build: '5/6',
      validate: '6/6',
    };

    const progress = stages[stage as keyof typeof stages] || '?/?';
    console.log(`\n[${progress}] ${stage.toUpperCase()}: ${message}`);
  }

  /**
   * Show error
   */
  showError(message: string, details?: string): void {
    console.error(`\n❌ ERROR: ${message}`);
    if (details) {
      console.error(`   Details: ${details}`);
    }
  }

  /**
   * Show success
   */
  showSuccess(message: string): void {
    console.log(`\n✅ SUCCESS: ${message}`);
  }

  /**
   * Show warning
   */
  showWarning(message: string): void {
    console.log(`\n⚠️  WARNING: ${message}`);
  }
}

export const ui = new UserInterface();
