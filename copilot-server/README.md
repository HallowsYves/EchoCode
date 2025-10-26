# Code Co-Pilot Backend Server

Express.js backend server with WebSocket support for real-time voice interaction.

## Features

- **WebSocket Server**: Bidirectional audio streaming
- **File Cache**: In-memory storage of watched files
- **API Integration**: 
  - Deepgram (Speech-to-Text)
  - Claude/Anthropic (LLM)
  - Fish Audio (Text-to-Speech)
- **HTTP Endpoints**: File update endpoint for CLI

## Installation

```bash
npm install
```

## Configuration

Copy `.env.example` to `.env` and configure your API keys:

```bash
cp .env.example .env
```

Required environment variables:
- `ANTHROPIC_API_KEY` - Your Anthropic API key for Claude
- `DEEPGRAM_API_KEY` - Your Deepgram API key for STT
- `FISH_AUDIO_API_KEY` - Your Fish Audio API key for TTS

## Development

```bash
npm run dev
```

Server will start on http://localhost:3001

## Production

```bash
npm run build
npm start
```

## API Endpoints

### POST /api/update-file
Receives file updates from the CLI watcher.

**Request Body:**
```json
{
  "filePath": "relative/path/to/file.js",
  "content": "file content here",
  "timestamp": 1234567890
}
```

### GET /api/files
Lists all cached files.

### GET /health
Health check endpoint.

### WebSocket /ws
WebSocket endpoint for bidirectional audio streaming.

## Architecture

```
src/
├── index.ts              # Main server entry point
├── routes/
│   └── fileUpdate.ts     # File update HTTP routes
├── websocket/
│   └── audioHandler.ts   # WebSocket audio handling
└── services/
    ├── fileCache.ts      # In-memory file cache
    ├── speechToText.ts   # Deepgram STT integration
    ├── llm.ts            # Claude LLM integration
    └── textToSpeech.ts   # Fish Audio TTS integration
```

## TODO

- [ ] Complete Deepgram streaming implementation
- [ ] Complete Fish Audio streaming implementation
- [ ] Add authentication/authorization
- [ ] Add rate limiting
- [ ] Implement proper audio buffer management
- [ ] Add conversation history
- [ ] Implement semantic search for file context
