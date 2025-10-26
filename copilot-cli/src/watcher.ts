import chokidar from 'chokidar';
import * as fs from 'fs/promises';
import * as path from 'path';

// Some change

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

  // Shared function to send file updates to backend
  async function sendFileUpdate(filePath: string, serverUrl: string): Promise<void> {
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
  }

  // Function to send file deletion notification to backend
  async function sendDeleteNotification(filePath: string, serverUrl: string): Promise<void> {
    try {
      // Prepare payload with absolute file path
      const payload = {
        filePath: path.resolve(filePath),
      };

      // Send delete notification to backend using fetch
      const response = await fetch(`${serverUrl}/api/delete-file`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        console.log(`✅ Removed from cache: ${filePath}`);
      } else {
        const errorText = await response.text();
        console.error(`❌ Failed to remove from cache: ${filePath}: ${response.status} ${errorText}`);
      }
    } catch (error) {
      if (error instanceof Error) {
        console.error(`❌ Failed to remove from cache: ${filePath}: ${error.message}`);
      } else {
        console.error(`❌ Failed to remove from cache: ${filePath}:`, error);
      }
    }
  }

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

  // Handle 'add' event for new files
  watcher.on('add', async (filePath: string) => {
    console.log(`➕ File added: ${filePath}`);
    // Send the content of newly added files too
    try {
      // Wait a brief moment in case the file is still being written
      await new Promise(resolve => setTimeout(resolve, 150)); // Small delay

      await sendFileUpdate(filePath, serverUrl);
    } catch (error) {
      // Handle errors reading the new file (e.g., might be a temp file quickly deleted)
      if (error instanceof Error && (error as any).code === 'ENOENT') {
        // Ignore if file not found (deleted quickly)
        // Silently skip
      } else {
        console.error(`❌ Error processing newly added file ${filePath}:`, error instanceof Error ? error.message : error);
      }
    }
  });

  // Handle 'change' event
  watcher.on('change', async (filePath: string) => {
    console.log(`File changed: ${filePath}`);
    await sendFileUpdate(filePath, serverUrl);
  });

  // Handle 'unlink' event for file deletion
  watcher.on('unlink', async (filePath: string) => {
    console.log(`🗑️ File deleted: ${filePath}`);
    await sendDeleteNotification(filePath, serverUrl);
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
