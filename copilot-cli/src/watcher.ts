import chokidar from 'chokidar';
import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * Main file watcher function that monitors a directory and sends updates to the backend server
 * @param directoryPath - The directory to watch
 * @param serverUrl - The backend server URL
 */
export async function startWatcher(directoryPath: string, serverUrl: string): Promise<void> {
  // Resolve the absolute path
  const absolutePath = path.resolve(directoryPath);

  // Verify directory exists
  try {
    await fs.access(absolutePath);
  } catch (error) {
    throw new Error(`Directory does not exist: ${absolutePath}`);
  }

  console.log(`👀 Starting file watcher...`);
  console.log(`Directory: ${absolutePath}`);
  console.log(`Backend: ${serverUrl}`);

  // Initialize chokidar watcher
  const watcher = chokidar.watch(absolutePath, {
    ignored: [
      /(^|[\/\\])\../, // Ignore dotfiles and dot directories
      '**/node_modules/**',
      '**/.git/**',
      '**/dist/**',
      '**/build/**',
    ],
    persistent: true,
    ignoreInitial: true, // Don't send updates for files existing at startup
    awaitWriteFinish: {
      stabilityThreshold: 500,
      pollInterval: 100,
    },
  });

  // Handle 'change' event
  watcher.on('change', async (filePath: string) => {
    console.log(`File changed: ${filePath}`);

    try {
      // Read file content
      const content = await fs.readFile(filePath, 'utf-8');

      // Prepare payload
      const payload = {
        filePath: path.resolve(filePath),
        content,
      };

      // Send update to backend using fetch
      const response = await fetch(`${serverUrl}/api/update-file`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        console.log(`✅ Updated context for ${filePath}`);
      } else {
        const errorText = await response.text();
        console.error(`❌ Failed to update context for ${filePath}: ${response.status} ${errorText}`);
      }
    } catch (error) {
      if (error instanceof Error) {
        console.error(`❌ Failed to update context for ${filePath}: ${error.message}`);
      } else {
        console.error(`❌ Failed to update context for ${filePath}:`, error);
      }
    }
  });

  // Handle 'error' event
  watcher.on('error', (error: Error) => {
    console.error(`Watcher error: ${error}`);
  });

  // Handle 'ready' event
  watcher.on('ready', () => {
    console.log(`👀 Initial scan complete. Ready for changes in ${absolutePath}...`);
  });

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n\nShutting down watcher...');
    watcher.close();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    watcher.close();
    process.exit(0);
  });
}
