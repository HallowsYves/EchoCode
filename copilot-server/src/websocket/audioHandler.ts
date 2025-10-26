import { WebSocket } from 'ws';
import { IncomingMessage } from 'http';
import { transcribeAudioStream } from '../services/speechToText';
import { getClaudeResponse } from '../services/llm';
import { synthesizeSpeechStream } from '../services/textToSpeech';

interface AudioMessage {
  type: 'audio' | 'control' | 'transcript';
  data?: any;
  action?: string;
}

/**
 * Handles WebSocket connections for bidirectional audio streaming
 */
export async function handleWebSocketConnection(ws: WebSocket, req: IncomingMessage) {
  let isSessionActive = true;
  let audioBuffer: Buffer[] = [];

  ws.on('message', async (message: Buffer) => {
    try {
      // Try to parse as JSON for control messages
      try {
        const parsed: AudioMessage = JSON.parse(message.toString());
        
        if (parsed.type === 'control') {
          await handleControlMessage(parsed, ws);
          return;
        }
        
        if (parsed.type === 'transcript') {
          // Manual transcript input
          await handleTranscript(parsed.data, ws);
          return;
        }
      } catch {
        // Not JSON, treat as raw audio data
        audioBuffer.push(message);
      }

      // Process audio chunks
      if (message.length > 0 && isSessionActive) {
        await handleAudioChunk(message, ws);
      }
    } catch (error) {
      console.error('Error handling WebSocket message:', error);
      ws.send(JSON.stringify({
        type: 'error',
        message: error instanceof Error ? error.message : 'Unknown error'
      }));
    }
  });

  ws.on('close', () => {
    console.log('WebSocket client disconnected');
    isSessionActive = false;
    audioBuffer = [];
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
    isSessionActive = false;
  });

  // Send ready message
  ws.send(JSON.stringify({
    type: 'ready',
    message: 'WebSocket connection established'
  }));
}

/**
 * Handle control messages (mute, unmute, end session, etc.)
 */
async function handleControlMessage(message: AudioMessage, ws: WebSocket) {
  switch (message.action) {
    case 'end_session':
      ws.send(JSON.stringify({ type: 'session_ended' }));
      ws.close();
      break;
    case 'mute':
      ws.send(JSON.stringify({ type: 'muted' }));
      break;
    case 'unmute':
      ws.send(JSON.stringify({ type: 'unmuted' }));
      break;
    default:
      console.log('Unknown control action:', message.action);
  }
}

/**
 * Process audio chunk through STT → LLM → TTS pipeline
 */
async function handleAudioChunk(audioData: Buffer, ws: WebSocket) {
  try {
    // TODO: Implement audio streaming buffer management
    // For now, we'll process each chunk individually
    
    // Step 1: Transcribe audio to text (Deepgram)
    const transcript = await transcribeAudioStream(audioData);
    
    if (!transcript || transcript.trim().length === 0) {
      return; // No speech detected
    }

    // Send transcript to frontend
    ws.send(JSON.stringify({
      type: 'transcript',
      data: transcript
    }));

    // Step 2: Get AI response from Claude
    await handleTranscript(transcript, ws);
    
  } catch (error) {
    console.error('Error processing audio chunk:', error);
    throw error;
  }
}

/**
 * Process transcript through LLM and TTS
 */
async function handleTranscript(transcript: string, ws: WebSocket) {
  try {
    // Get AI response
    const aiResponse = await getClaudeResponse(transcript);
    
    // Send text response to frontend
    ws.send(JSON.stringify({
      type: 'ai_response',
      data: aiResponse
    }));

    // Step 3: Synthesize speech (Fish Audio TTS)
    const audioStream = await synthesizeSpeechStream(aiResponse);
    
    // Stream audio back to frontend
    for await (const chunk of audioStream) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'audio',
          data: chunk.toString('base64')
        }));
      }
    }

    // Signal end of audio
    ws.send(JSON.stringify({
      type: 'audio_end'
    }));
    
  } catch (error) {
    console.error('Error handling transcript:', error);
    throw error;
  }
}
