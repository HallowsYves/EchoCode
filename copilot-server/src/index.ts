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

// Global error handlers (last resort - specific try-catch blocks are preferred)
process.on('uncaughtException', (error) => {
  console.error('💥 UNCAUGHT EXCEPTION! Server stability compromised:', error);
  console.error('Stack trace:', error.stack);
  // Log but don't crash - let the server attempt to recover
  // In production, you might want to implement graceful shutdown here
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('💥 UNHANDLED PROMISE REJECTION!');
  console.error('Promise:', promise);
  console.error('Reason:', reason);
  // Log the rejection but don't crash
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});
