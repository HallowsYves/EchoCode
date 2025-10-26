import 'dotenv/config';

// Verify critical environment variables at startup
console.log('========================================');
console.log('🔧 Environment Variables Check:');
console.log('   PORT:', process.env.PORT || '3001 (default)');
console.log('   DEEPGRAM_API_KEY:', process.env.DEEPGRAM_API_KEY ? `✅ Loaded (${process.env.DEEPGRAM_API_KEY.slice(0, 8)}...${process.env.DEEPGRAM_API_KEY.slice(-4)})` : '❌ NOT SET');
console.log('   ANTHROPIC_API_KEY:', process.env.ANTHROPIC_API_KEY ? `✅ Loaded (...${process.env.ANTHROPIC_API_KEY.slice(-4)})` : '❌ NOT SET');
console.log('   FISH_AUDIO_API_KEY:', process.env.FISH_AUDIO_API_KEY ? `✅ Loaded (...${process.env.FISH_AUDIO_API_KEY.slice(-4)})` : '❌ NOT SET');
console.log('========================================\n');

import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { fileUpdateRouter } from './routes/fileUpdate';
import { handleWebSocketConnection } from './websocket/audioHandler';

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Routes
app.use('/api', fileUpdateRouter);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Create HTTP server
const server = createServer(app);

// Create WebSocket server
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws, req) => {
  console.log('WebSocket client connected');
  handleWebSocketConnection(ws, req);
});

// Start server
server.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`🔌 WebSocket server ready on ws://localhost:${PORT}/ws`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});
