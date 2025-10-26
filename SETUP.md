# Setup Guide: Real-Time Voice Code Co-Pilot

Complete setup instructions for the CalHacks voice-interactive coding assistant.

## Prerequisites

- **Node.js**: v18 or higher
- **npm** or **yarn**
- **API Keys**:
  - [Anthropic API Key](https://console.anthropic.com/) for Claude
  - [Deepgram API Key](https://console.deepgram.com/) for Speech-to-Text
  - [Fish Audio API Key](https://fish.audio/) for Text-to-Speech

## Quick Start (All Components)

### 1. Clone and Setup

```bash
git clone <repository-url>
cd Real-time-Code-Co-Pilot
```

### 2. Backend Setup

```bash
cd copilot-server
npm install
cp .env.example .env
```

Edit `.env` and add your API keys:
```env
ANTHROPIC_API_KEY=your_anthropic_key
DEEPGRAM_API_KEY=your_deepgram_key
FISH_AUDIO_API_KEY=your_fish_audio_key
```

Start the server:
```bash
npm run dev
```

Server runs on: http://localhost:3001

### 3. Frontend Setup

```bash
cd ../copilot-ui
npm install
cp .env.local.example .env.local
```

Start the UI:
```bash
npm run dev
```

UI runs on: http://localhost:3000

### 4. CLI Setup

```bash
cd ../copilot-cli
npm install
npm link  # Makes CLI globally available
```

Watch your project:
```bash
copilot-watch /path/to/your/project
```

## Detailed Setup

### Backend Configuration

The backend requires three API integrations:

#### 1. Anthropic (Claude)
- Sign up at https://console.anthropic.com/
- Create an API key
- Add to `.env`: `ANTHROPIC_API_KEY=sk-ant-...`

#### 2. Deepgram (STT)
- Sign up at https://console.deepgram.com/
- Create an API key
- Add to `.env`: `DEEPGRAM_API_KEY=...`

#### 3. Fish Audio (TTS)
- Sign up at https://fish.audio/
- Get API credentials
- Add to `.env`: `FISH_AUDIO_API_KEY=...`

### Frontend Configuration

Create `.env.local`:
```env
NEXT_PUBLIC_WS_URL=ws://localhost:3001/ws
NEXT_PUBLIC_API_URL=http://localhost:3001/api
```

### CLI Configuration

Create `.env`:
```env
BACKEND_URL=http://localhost:3001
WATCH_EXTENSIONS=.js,.ts,.jsx,.tsx,.py,.java,.cpp,.c,.go,.rs
DEBOUNCE_MS=500
```

## Testing the System

### 1. Start Backend
```bash
cd copilot-server
npm run dev
```

Expected output:
```
🚀 Server running on http://localhost:3001
🔌 WebSocket server ready on ws://localhost:3001/ws
```

### 2. Start Frontend
```bash
cd copilot-ui
npm run dev
```

Open browser to http://localhost:3000

### 3. Start CLI Watcher
```bash
cd copilot-cli
copilot-watch /path/to/test/project
```

Expected output:
```
🚀 Code Co-Pilot File Watcher
Watching: /path/to/test/project
✓ Backend connection successful
✓ Watcher started successfully!
```

### 4. Test Voice Interaction

1. Click "Start Recording" in the UI
2. Speak a coding question
3. See your transcript appear
4. Receive AI response (text and audio)

## Troubleshooting

### Backend Won't Start
- Check Node.js version: `node --version` (need v18+)
- Verify all dependencies installed: `npm install`
- Check port 3001 is available: `lsof -i :3001`

### Frontend Connection Issues
- Verify backend is running
- Check WebSocket URL in `.env.local`
- Open browser console for errors

### CLI Can't Connect
- Verify backend is running at configured URL
- Test with: `curl http://localhost:3001/health`
- Check firewall settings

### Microphone Not Working
- Allow browser microphone permissions
- Check browser console for errors
- Test microphone in browser settings

### API Integration Issues

**Anthropic/Claude:**
- Verify API key is valid
- Check account has credits
- Review Anthropic status page

**Deepgram:**
- Verify API key is valid
- Check account has credits
- Test with smaller audio samples

**Fish Audio:**
- Verify API credentials
- Check API endpoint URL
- Review Fish Audio documentation

## Development Workflow

### Running All Services

Use three terminal windows:

**Terminal 1 - Backend:**
```bash
cd copilot-server && npm run dev
```

**Terminal 2 - Frontend:**
```bash
cd copilot-ui && npm run dev
```

**Terminal 3 - CLI:**
```bash
cd copilot-cli && copilot-watch .
```

### Building for Production

**Backend:**
```bash
cd copilot-server
npm run build
npm start
```

**Frontend:**
```bash
cd copilot-ui
npm run build
npm start
```

**CLI:**
```bash
cd copilot-cli
npm run build
node dist/index.js
```

## Next Steps

1. **Complete API Integrations**: Implement the TODO sections in:
   - `copilot-server/src/services/speechToText.ts`
   - `copilot-server/src/services/textToSpeech.ts`

2. **Enhance Audio Handling**: 
   - Implement proper streaming for STT
   - Add audio buffer management for TTS playback

3. **Improve Context**: 
   - Implement semantic search for file context
   - Add conversation history

4. **Testing**:
   - Test with various file types
   - Test with different audio inputs
   - Load test the WebSocket connection

## Architecture Overview

```
┌─────────────┐
│   Browser   │
│  (copilot-  │
│     ui)     │
└──────┬──────┘
       │ WebSocket
       │ (Audio + Control)
       ▼
┌─────────────┐      ┌──────────────┐
│   Backend   │◄─────┤     CLI      │
│  (copilot-  │ HTTP │  (copilot-   │
│   server)   │      │     cli)     │
└──────┬──────┘      └──────────────┘
       │
       ├─► Deepgram (STT)
       ├─► Claude (LLM)
       └─► Fish Audio (TTS)
```

## Support

For issues or questions:
1. Check this setup guide
2. Review component READMEs
3. Check TODO comments in code
4. Review API documentation for external services

## License

MIT
