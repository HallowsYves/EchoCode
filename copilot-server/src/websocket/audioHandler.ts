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
  console.log('🔗 [CONNECTION] New WebSocket client connected');
  
  let isSessionActive = true;
  let transcriber: DeepgramTranscriber | null = null;
  let fullTranscript = '';

  // STRATEGY: Create transcriber instance on-demand when start_recording is received
  // This ensures clean state for each recording session
  console.log('📝 [CONNECTION] Using on-demand transcriber creation strategy');
  
  // Function to setup transcriber event handlers
  const setupTranscriberHandlers = (t: DeepgramTranscriber) => {
    console.log('🔧 [SETUP] Setting up transcriber event handlers...');
    
    // Handle transcript events
    t.on('transcript', async (text: string, isFinal: boolean) => {
      console.log(`📥 [TRANSCRIPT] Received transcript event (isFinal: ${isFinal}, transcriber.isActive(): ${t.isActive()})`);
      
      if (isFinal) {
        fullTranscript += text + ' ';
        
        // Send transcript to client
        ws.send(JSON.stringify({
          type: 'transcript',
          data: text,
          isFinal: true
        }));
        
        console.log(`   [TRANSCRIPT] Transcriber state before LLM processing: ${t.isActive()}`);

        // Process complete utterance through LLM and TTS
        if (text.length > 5) { // Only process substantial text
          await handleTranscript(text, ws);
        }
        
        console.log(`   [TRANSCRIPT] Transcriber state after LLM processing: ${t.isActive()}`);
      } else {
        // Send interim results to client
        ws.send(JSON.stringify({
          type: 'transcript',
          data: text,
          isFinal: false
        }));
      }
    });

    t.on('error', (error: Error) => {
      console.error('❌ [ERROR] Transcriber error:', error);
      ws.send(JSON.stringify({
        type: 'error',
        message: 'Transcription error: ' + error.message
      }));
    });
    
    console.log('✅ [SETUP] Transcriber event handlers configured');
  };

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
          // Start transcription session with FRESH transcriber instance
          console.log('🎹️ [START_RECORDING] Received start_recording command');
          
          try {
            // Clean up any existing transcriber first
            if (transcriber) {
              console.log('🧹 [START_RECORDING] Cleaning up existing transcriber before creating new one...');
              await transcriber.stop();
              transcriber.removeAllListeners();
              transcriber = null;
            }
            
            // Create FRESH transcriber instance for clean state
            console.log('🎵 [START_RECORDING] Creating fresh DeepgramTranscriber instance...');
            transcriber = new DeepgramTranscriber();
            setupTranscriberHandlers(transcriber);
            
            // Start the transcriber
            console.log('🚀 [START_RECORDING] Starting Deepgram transcriber...');
            await transcriber.start(); // WAIT for connection to open
            console.log('✅ [START_RECORDING] Transcriber started successfully');
            console.log(`   State check: isActive() = ${transcriber.isActive()}`);
            
            ws.send(JSON.stringify({
              type: 'recording_started'
            }));
          } catch (error) {
            console.error('❌ [START_RECORDING] Failed to start transcriber:', error);
            ws.send(JSON.stringify({
              type: 'error',
              message: 'Failed to start recording: ' + (error instanceof Error ? error.message : 'Unknown error')
            }));
          }
          
          return;
        }

        if (parsed.type === 'stop_recording') {
          // Stop transcription session and cleanup
          console.log('🛑 [STOP_RECORDING] Received stop_recording command');
          console.log(`   Transcriber state: exists=${transcriber !== null}, active=${transcriber?.isActive()}, ready=${transcriber?.isConnectionReady()}`);
          
          if (transcriber) {
            try {
              console.log('🛑 [STOP_RECORDING] Calling transcriber.stop()...');
              await transcriber.stop();
              console.log('✅ [STOP_RECORDING] Transcriber stopped successfully');
              
              // Clean up transcriber instance
              console.log('🧹 [STOP_RECORDING] Removing event listeners and nullifying transcriber...');
              transcriber.removeAllListeners();
              transcriber = null;
              console.log('✅ [STOP_RECORDING] Transcriber cleanup complete');
              
              ws.send(JSON.stringify({
                type: 'recording_stopped',
                fullTranscript
              }));
              fullTranscript = ''; // Reset
            } catch (error) {
              console.error('❌ [STOP_RECORDING] Error stopping transcriber:', error);
              ws.send(JSON.stringify({
                type: 'error',
                message: 'Failed to stop recording: ' + (error instanceof Error ? error.message : 'Unknown error')
              }));
            }
          } else {
            console.warn('⚠️ [STOP_RECORDING] stop_recording called but no transcriber instance exists');
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
        // console.log(`🎵 [AUDIO] Binary audio data received: ${message.length} bytes`);
        
        // Enhanced checks before forwarding audio
        if (transcriber && transcriber.isActive() && transcriber.isConnectionReady() && isSessionActive) {
          // Send audio chunk to Deepgram (comment out verbose logging to reduce noise)
          // console.log(`📤 [AUDIO] Forwarding audio chunk... (State: active=${transcriber.isActive()}, ready=${transcriber.isConnectionReady()})`);
          transcriber.sendAudio(message);
        } else {
          // Detailed diagnostic logging only on failure
          console.warn(`⚠️ [AUDIO] Cannot forward audio - State check failed:`);
          console.warn(`   • transcriber exists: ${transcriber !== null}`);
          console.warn(`   • transcriber.isActive(): ${transcriber?.isActive()}`);
          console.warn(`   • transcriber.isConnectionReady(): ${transcriber?.isConnectionReady()}`);
          console.warn(`   • sessionActive: ${isSessionActive}`);
          
          // Provide specific reasons
          if (!transcriber) {
            console.warn('   → Reason: No transcriber instance (did start_recording arrive?)');
          } else if (!transcriber.isActive()) {
            console.warn('   → Reason: Transcriber not active. Call start_recording first.');
          } else if (!transcriber.isConnectionReady()) {
            console.warn('   → Reason: Connection not ready (WebSocket may be closed/closing)');
          } else if (!isSessionActive) {
            console.warn('   → Reason: Session not active');
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
    console.log('🔌 [DISCONNECT] WebSocket client disconnected');
    console.log(`   Transcriber state at disconnect: exists=${transcriber !== null}, active=${transcriber?.isActive()}, ready=${transcriber?.isConnectionReady()}`);
    isSessionActive = false;
    
    // Clean up transcriber
    if (transcriber) {
      console.log('🧹 [DISCONNECT] Cleaning up transcriber (initiated by client disconnect)...');
      try {
        await transcriber.stop();
        transcriber.removeAllListeners();
        transcriber = null;
        console.log('✅ [DISCONNECT] Transcriber cleanup complete');
      } catch (error) {
        console.error('❌ [DISCONNECT] Error during transcriber cleanup:', error);
      }
    }
  });

  ws.on('error', async (error) => {
    console.error('❌ [WS_ERROR] WebSocket error:', error);
    isSessionActive = false;
    
    // Clean up transcriber
    if (transcriber) {
      console.log('🧹 [WS_ERROR] Cleaning up transcriber after WebSocket error...');
      try {
        await transcriber.stop();
        transcriber.removeAllListeners();
        transcriber = null;
        console.log('✅ [WS_ERROR] Transcriber cleanup complete');
      } catch (cleanupError) {
        console.error('❌ [WS_ERROR] Error during transcriber cleanup:', cleanupError);
      }
    }
  });

  // Send ready message
  console.log('✅ [CONNECTION] Sending ready message to client');
  ws.send(JSON.stringify({
    type: 'ready',
    message: 'WebSocket connection established'
  }));
  console.log('📝 [CONNECTION] WebSocket setup complete - waiting for start_recording command');
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
