# Code Co-Pilot Frontend UI

Next.js sidecar UI for voice interaction with the coding assistant.

## Features

- **Voice Recording**: Capture microphone input
- **WebSocket Communication**: Real-time audio streaming
- **Live Transcription**: Display speech-to-text results
- **AI Response Display**: Show Claude's responses
- **Audio Playback**: Play TTS audio from backend
- **Modern UI**: Tailwind CSS styling

## Installation

```bash
npm install
```

## Configuration

Copy `.env.local.example` to `.env.local`:

```bash
cp .env.local.example .env.local
```

Configure environment variables:
- `NEXT_PUBLIC_WS_URL` - WebSocket URL (default: ws://localhost:3001/ws)
- `NEXT_PUBLIC_API_URL` - Backend API URL (default: http://localhost:3001/api)

## Development

```bash
npm run dev
```

App will start on http://localhost:3000

## Production

```bash
npm run build
npm start
```

## Project Structure

```
src/
├── app/
│   ├── layout.tsx        # Root layout
│   ├── page.tsx          # Home page
│   └── globals.css       # Global styles
├── components/
│   └── SidecarView.tsx   # Main sidecar component
└── hooks/
    ├── useWebSocket.ts   # WebSocket connection hook
    └── useMicrophone.ts  # Microphone capture hook
```

## Components

### SidecarView
Main UI component with:
- Microphone controls (record/stop)
- Mute toggle
- Transcript display
- AI response display
- Connection status

### Custom Hooks

#### useWebSocket
Manages WebSocket connection with:
- Automatic reconnection
- Message handling
- Connection status tracking

#### useMicrophone
Handles microphone access with:
- MediaRecorder API
- Audio chunk streaming
- Error handling

## TODO

- [ ] Implement audio playback buffer
- [ ] Add visualization for audio levels
- [ ] Implement conversation history UI
- [ ] Add settings panel
- [ ] Improve mobile responsiveness
- [ ] Add dark mode toggle
