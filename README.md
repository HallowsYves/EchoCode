# Real-Time Voice Code Co-Pilot

A voice-interactive coding assistant that monitors local files and provides AI-powered code assistance using Claude.

## Architecture

### Components

1. **copilot-ui** - Frontend sidecar UI (Next.js/React/TypeScript)
2. **copilot-server** - Backend server (Node.js/Express/TypeScript)
3. **copilot-cli** - File watcher CLI (Node.js/TypeScript)

### System Flow

```
File Changes → CLI (chokidar) → Backend (file cache)
User Voice → Frontend (WebSocket) → Backend (Deepgram STT) → Claude (LLM) → Fish Audio (TTS) → Frontend
```

## Setup

### Prerequisites

- Node.js 18+ 
- npm or yarn
- API Keys:
  - Anthropic (Claude)
  - Deepgram (Speech-to-Text)
  - Fish Audio (Text-to-Speech)

### Installation

1. **Backend Setup**
   ```bash
   cd copilot-server
   npm install
   cp .env.example .env
   # Add your API keys to .env
   npm run dev
   ```

2. **Frontend Setup**
   ```bash
   cd copilot-ui
   npm install
   cp .env.local.example .env.local
   # Configure backend URL
   npm run dev
   ```

3. **CLI Setup**
   ```bash
   cd copilot-cli
   npm install
   npm link
   ```

### Usage

1. Start the backend server (default: http://localhost:3001)
2. Start the frontend UI (default: http://localhost:3000)
3. Run the CLI to watch your project:
   ```bash
   copilot-watch /path/to/your/project
   ```

## Development

Each component is a standalone TypeScript project:

- **copilot-server**: WebSocket server, file cache, API orchestration
- **copilot-ui**: Next.js app with real-time audio streaming
- **copilot-cli**: File system watcher with HTTP client

## Tech Stack

- **LLM**: Claude (Anthropic SDK)
- **TTS**: Fish Audio API
- **STT**: Deepgram API
- **Frontend**: Next.js 14, React, TypeScript
- **Backend**: Express.js, ws (WebSocket)
- **File Watching**: chokidar

## License

MIT
