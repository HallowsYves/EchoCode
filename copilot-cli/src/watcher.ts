import chokidar, { FSWatcher } from 'chokidar';
import axios from 'axios';
import * as fs from 'fs/promises';
import * as path from 'path';
import chalk from 'chalk';

interface FileWatcherOptions {
  directory: string;
  backendUrl: string;
  extensions?: string[];
  ignorePatterns?: string[];
  debounceMs?: number;
}

export class FileWatcher {
  private watcher: FSWatcher | null = null;
  private options: Required<FileWatcherOptions>;
  private pendingUpdates: Map<string, NodeJS.Timeout> = new Map();

  constructor(options: FileWatcherOptions) {
    this.options = {
      directory: path.resolve(options.directory),
      backendUrl: options.backendUrl,
      extensions: options.extensions || ['.js', '.ts', '.jsx', '.tsx', '.py', '.java', '.cpp', '.c', '.go', '.rs'],
      ignorePatterns: options.ignorePatterns || ['node_modules/**', 'dist/**', '.git/**'],
      debounceMs: options.debounceMs || 500,
    };
  }

  async start(): Promise<void> {
    // Verify directory exists
    try {
      await fs.access(this.options.directory);
    } catch (error) {
      throw new Error(`Directory does not exist: ${this.options.directory}`);
    }

    // Test backend connection
    await this.testConnection();

    // Initialize chokidar watcher
    this.watcher = chokidar.watch(this.options.directory, {
      ignored: this.options.ignorePatterns,
      persistent: true,
      ignoreInitial: true, // Don't fire events for initial files
      awaitWriteFinish: {
        stabilityThreshold: 300,
        pollInterval: 100,
      },
    });

    // Set up event handlers
    this.watcher
      .on('add', (filePath) => this.handleFileChange(filePath, 'added'))
      .on('change', (filePath) => this.handleFileChange(filePath, 'modified'))
      .on('unlink', (filePath) => this.handleFileDelete(filePath))
      .on('error', (error) => console.error(chalk.red('Watcher error:'), error));

    console.log(chalk.gray(`Watching extensions: ${this.options.extensions.join(', ')}`));
  }

  stop(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }

    // Clear pending updates
    for (const timeout of this.pendingUpdates.values()) {
      clearTimeout(timeout);
    }
    this.pendingUpdates.clear();

    console.log(chalk.green('Watcher stopped'));
  }

  private async testConnection(): Promise<void> {
    try {
      const response = await axios.get(`${this.options.backendUrl}/health`, {
        timeout: 5000,
      });
      
      if (response.status === 200) {
        console.log(chalk.green('✓ Backend connection successful'));
      }
    } catch (error) {
      throw new Error(`Cannot connect to backend at ${this.options.backendUrl}. Please ensure the server is running.`);
    }
  }

  private handleFileChange(filePath: string, action: 'added' | 'modified'): void {
    // Check if file extension is in the watch list
    const ext = path.extname(filePath);
    if (!this.options.extensions.includes(ext)) {
      return; // Skip files with unwanted extensions
    }

    // Clear existing timeout for this file
    const existingTimeout = this.pendingUpdates.get(filePath);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
    }

    // Set new debounced update
    const timeout = setTimeout(() => {
      this.sendFileUpdate(filePath, action);
      this.pendingUpdates.delete(filePath);
    }, this.options.debounceMs);

    this.pendingUpdates.set(filePath, timeout);
  }

  private async handleFileDelete(filePath: string): Promise<void> {
    // Clear any pending updates for this file
    const existingTimeout = this.pendingUpdates.get(filePath);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
      this.pendingUpdates.delete(filePath);
    }

    // TODO: Optionally send delete notification to backend
    console.log(chalk.yellow(`📝 File deleted: ${path.relative(this.options.directory, filePath)}`));
  }

  private async sendFileUpdate(filePath: string, action: 'added' | 'modified'): Promise<void> {
    try {
      // Read file content
      const content = await fs.readFile(filePath, 'utf-8');
      const relativePath = path.relative(this.options.directory, filePath);

      // Send to backend
      await axios.post(
        `${this.options.backendUrl}/api/update-file`,
        {
          filePath: relativePath,
          content,
          timestamp: Date.now(),
        },
        {
          headers: {
            'Content-Type': 'application/json',
          },
          timeout: 10000,
        }
      );

      const actionEmoji = action === 'added' ? '➕' : '📝';
      console.log(chalk.blue(`${actionEmoji} File ${action}: ${relativePath}`));
      
    } catch (error) {
      if (axios.isAxiosError(error)) {
        console.error(chalk.red(`Failed to send update for ${filePath}:`), error.message);
      } else {
        console.error(chalk.red(`Error reading file ${filePath}:`), error);
      }
    }
  }
}
