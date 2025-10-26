#!/usr/bin/env node

import 'dotenv/config';
import { Command } from 'commander';
import { FileWatcher } from './watcher';
import chalk from 'chalk';

const program = new Command();

program
  .name('copilot-watch')
  .description('Watch files and send updates to the Code Co-Pilot backend')
  .version('1.0.0')
  .argument('[directory]', 'Directory to watch', process.cwd())
  .option('-u, --url <url>', 'Backend API URL', process.env.BACKEND_URL || 'http://localhost:3001')
  .option('-e, --extensions <extensions>', 'File extensions to watch (comma-separated)', process.env.WATCH_EXTENSIONS)
  .option('-i, --ignore <patterns>', 'Patterns to ignore (comma-separated)', 'node_modules/**,dist/**,.git/**')
  .option('-d, --debounce <ms>', 'Debounce time in milliseconds', process.env.DEBOUNCE_MS || '500')
  .action(async (directory: string, options) => {
    try {
      console.log(chalk.blue.bold('\n🚀 Code Co-Pilot File Watcher\n'));
      console.log(chalk.gray(`Watching: ${directory}`));
      console.log(chalk.gray(`Backend: ${options.url}`));
      
      const watcher = new FileWatcher({
        directory,
        backendUrl: options.url,
        extensions: options.extensions ? options.extensions.split(',') : undefined,
        ignorePatterns: options.ignore.split(','),
        debounceMs: parseInt(options.debounce),
      });

      await watcher.start();
      
      console.log(chalk.green('\n✓ Watcher started successfully!\n'));
      console.log(chalk.yellow('Press Ctrl+C to stop watching...\n'));

      // Handle graceful shutdown
      process.on('SIGINT', () => {
        console.log(chalk.yellow('\n\nShutting down watcher...'));
        watcher.stop();
        process.exit(0);
      });

      process.on('SIGTERM', () => {
        watcher.stop();
        process.exit(0);
      });

    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

program.parse();
