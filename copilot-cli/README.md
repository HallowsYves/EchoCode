# Code Co-Pilot CLI

File watcher CLI that monitors your project and sends file updates to the backend.

## Features

- **File Watching**: Monitor directory for file changes using chokidar
- **Smart Filtering**: Watch only specified file extensions
- **Debouncing**: Avoid sending too many updates
- **Automatic Sync**: Send file content to backend on save

## Installation

```bash
npm install
npm link  # Makes 'copilot-watch' available globally
```

Or install locally:
```bash
npm install
```

## Usage

### Global (after npm link)

```bash
copilot-watch [directory] [options]
```

### Local

```bash
npx ts-node src/index.ts [directory] [options]
```

### Options

- `-u, --url <url>` - Backend API URL (default: http://localhost:3001)
- `-e, --extensions <extensions>` - File extensions to watch (comma-separated)
- `-i, --ignore <patterns>` - Patterns to ignore (comma-separated)
- `-d, --debounce <ms>` - Debounce time in milliseconds (default: 500)

### Examples

Watch current directory:
```bash
copilot-watch
```

Watch specific directory:
```bash
copilot-watch /path/to/project
```

Watch only JavaScript/TypeScript files:
```bash
copilot-watch --extensions .js,.ts,.jsx,.tsx
```

Custom backend URL:
```bash
copilot-watch --url http://localhost:8080
```

## Configuration

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

Environment variables:
- `BACKEND_URL` - Backend API endpoint
- `WATCH_EXTENSIONS` - Default file extensions to watch
- `DEBOUNCE_MS` - Default debounce time

## How It Works

1. Monitors specified directory for file changes
2. Filters changes based on file extensions
3. Debounces rapid changes to avoid spam
4. Reads file content on change
5. POSTs file path and content to backend `/api/update-file`

## Project Structure

```
src/
├── index.ts     # CLI entry point with Commander.js
└── watcher.ts   # FileWatcher class with chokidar
```

## TODO

- [ ] Add file deletion sync
- [ ] Implement incremental updates (diffs)
- [ ] Add encryption for sensitive files
- [ ] Support multiple backend servers
- [ ] Add file size limits
- [ ] Implement compression for large files
