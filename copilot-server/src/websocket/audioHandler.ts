import { WebSocket } from 'ws';
import { IncomingMessage } from 'http';
import { DeepgramTranscriber } from '../services/speechToText';
import { getClaudeResponse } from '../services/llm';
import { synthesizeSpeechStream } from '../services/textToSpeech';

interface AudioMessage {
  type: 'audio' | 'control' | 'transcript' | 'start_recording' | 'stop_recording';
  data?: any;
  action?: string;
}

/**
 * Handles WebSocket connections for bidirectional audio streaming
 */
export async function handleWebSocketConnection(ws: WebSocket, req: IncomingMessage) {
  let isSessionActive = true;
  let transcriber: DeepgramTranscriber | null = null;
  let fullTranscript = '';

  // Initialize Deepgram transcriber
  try {
    transcriber = new DeepgramTranscriber();
    
    // Handle transcript events
    transcriber.on('transcript', async (text: string, isFinal: boolean) => {
      console.log(`📥 audioHandler received transcript event (isFinal: ${isFinal}, transcriber.isActive(): ${transcriber?.isActive()})`);
      
      if (isFinal) {
        fullTranscript += text + ' ';
        
        // Send transcript to client
        ws.send(JSON.stringify({
          type: 'transcript',
          data: text,
          isFinal: true
        }));
        
        console.log(`   Transcriber state before LLM processing: ${transcriber?.isActive()}`);

        // Process complete utterance through LLM and TTS
        if (text.length > 5) { // Only process substantial text
          await handleTranscript(text, ws);
        }
        
        console.log(`   Transcriber state after LLM processing: ${transcriber?.isActive()}`);
      } else {
        // Send interim results to client
        ws.send(JSON.stringify({
          type: 'transcript',
          data: text,
          isFinal: false
        }));
      }
    });

    transcriber.on('error', (error: Error) => {
      console.error('Transcriber error:', error);
      ws.send(JSON.stringify({
        type: 'error',
        message: 'Transcription error: ' + error.message
      }));
    });

  } catch (error) {
    console.error('Failed to initialize transcriber:', error);
    ws.send(JSON.stringify({
      type: 'error',
      message: 'Failed to initialize speech recognition'
    }));
  }

  ws.on('message', async (message: Buffer) => {
    try {
      const messageStr = message.toString('utf8');
      console.log(`📨 Received message: ${message.length} bytes, first 100 chars: ${messageStr.substring(0, 100)}`);
      
      // Try to parse as JSON for control messages
      let parsed: AudioMessage | null = null;
      let isJson = false;
      
      try {
        parsed = JSON.parse(messageStr);
        isJson = true;
        
        if (!parsed || typeof parsed !== 'object') {
          throw new Error('Invalid JSON format');
        }
        
        console.log(`✅ Parsed JSON message type: ${parsed.type}`);
        
        if (parsed.type === 'control') {
          await handleControlMessage(parsed, ws, transcriber);
          return;
        }
        
        if (parsed.type === 'start_recording') {
          // Start transcription session
          console.log('🎙️ Received start_recording command');
          if (transcriber) {
            if (!transcriber.isActive()) {
              console.log('🚀 Starting Deepgram transcriber...');
              await transcriber.start(); // WAIT for connection to open
              console.log('✅ Transcriber started successfully');
              console.log(`   State check: isActive() = ${transcriber.isActive()}`);
              
              ws.send(JSON.stringify({
                type: 'recording_started'
              }));
            } else {
              console.log('⚠️ Transcriber already active');
            }
          } else {
            console.error('❌ No transcriber instance available');
          }
          return;
        }

        if (parsed.type === 'stop_recording') {
          // Stop transcription session
          if (transcriber && transcriber.isActive()) {
            await transcriber.stop();
            ws.send(JSON.stringify({
              type: 'recording_stopped',
              fullTranscript
            }));
            fullTranscript = ''; // Reset
          }
          return;
        }
        
        if (parsed.type === 'transcript') {
          // Manual transcript input (for testing without audio)
          await handleTranscript(parsed.data, ws);
          return;
        }
      } catch (parseError) {
        // Not JSON, treat as raw audio data
        console.log(`🎵 Binary audio data received (not JSON): ${message.length} bytes`);
        
        if (transcriber && transcriber.isActive() && isSessionActive) {
          // Send audio chunk to Deepgram
          console.log(`📤 Forwarding audio chunk to Deepgram (${message.length} bytes)`);
          transcriber.sendAudio(message);
        } else {
          console.warn(`⚠️ Cannot forward audio - transcriber active: ${transcriber?.isActive()}, session active: ${isSessionActive}`);
          if (!transcriber) console.warn('   → No transcriber instance');
          if (transcriber && !transcriber.isActive()) {
            console.warn('   → Transcriber exists but not active. Did start_recording message arrive?');
          }
        }
      }

    } catch (error) {
      console.error('Error handling WebSocket message:', error);
      ws.send(JSON.stringify({
        type: 'error',
        message: error instanceof Error ? error.message : 'Unknown error'
      }));
    }
  });

  ws.on('close', async () => {
    console.log('WebSocket client disconnected');
    isSessionActive = false;
    
    // Clean up transcriber
    if (transcriber) {
      await transcriber.stop();
      transcriber.removeAllListeners();
      transcriber = null;
    }
  });

  ws.on('error', async (error) => {
    console.error('WebSocket error:', error);
    isSessionActive = false;
    
    // Clean up transcriber
    if (transcriber) {
      await transcriber.stop();
      transcriber = null;
    }
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
async function handleControlMessage(
  message: AudioMessage, 
  ws: WebSocket, 
  transcriber: DeepgramTranscriber | null
) {
  switch (message.action) {
    case 'end_session':
      if (transcriber) {
        await transcriber.stop();
      }
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
 * Process transcript through LLM and TTS
 */
async function handleTranscript(transcript: string, ws: WebSocket) {
  try {
    console.log('Processing transcript:', transcript);
    
    // Step 1: Get AI response from Claude
    const aiResponse = await getClaudeResponse(transcript);
    
    // Send text response to frontend
    ws.send(JSON.stringify({
      type: 'ai_response',
      data: aiResponse
    }));

    // Step 2: Synthesize speech (Fish Audio TTS)
    try {
      let chunkCount = 0;
      
      for await (const chunk of synthesizeSpeechStream(aiResponse)) {
        if (ws.readyState === WebSocket.OPEN) {
          // Send audio chunk as base64 encoded JSON message
          // Frontend will decode and play
          ws.send(JSON.stringify({
            type: 'audio',
            data: chunk.toString('base64'),
            format: 'mp3',
            chunkIndex: chunkCount++
          }));
        } else {
          console.warn('WebSocket closed, stopping audio stream');
          break;
        }
      }

      // Signal end of audio stream
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'audio_end',
          totalChunks: chunkCount
        }));
      }
      
    } catch (ttsError) {
      console.error('TTS Error:', ttsError);
      ws.send(JSON.stringify({
        type: 'error',
        message: 'Failed to generate speech: ' + (ttsError instanceof Error ? ttsError.message : 'Unknown error')
      }));
    }
    
  } catch (error) {
    console.error('Error handling transcript:', error);
    ws.send(JSON.stringify({
      type: 'error',
      message: error instanceof Error ? error.message : 'Unknown error'
    }));
  }
}
