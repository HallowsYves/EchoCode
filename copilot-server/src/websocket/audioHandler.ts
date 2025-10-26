import { WebSocket } from 'ws';
import { IncomingMessage } from 'http';
import { DeepgramTranscriber } from '../services/speechToText';
import { getClaudeResponse } from '../services/llm';
import { synthesizeSpeechStream } from '../services/textToSpeech';
import { fileCache } from '../services/fileCache';

interface AudioMessage {
  type: 'audio' | 'control' | 'transcript' | 'start_recording' | 'stop_recording' | 'text_input';
  data?: any;
  action?: string;
  message?: string;
}

/**
 * Safely send a message via WebSocket with error handling
 * Prevents ETIMEDOUT crashes by catching network errors
 */
function safeSend(ws: WebSocket, data: string | Buffer, context: string = 'message'): boolean {
  try {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(data);
      return true;
    } else {
      console.warn(`[WS SEND] Cannot send ${context}: socket readyState is ${ws.readyState} (expected ${WebSocket.OPEN})`);
      return false;
    }
  } catch (sendError) {
    console.error(`[WS SEND ERROR] Failed to send ${context}:`, sendError);
    // Don't crash - the connection might recover or close gracefully later
    return false;
  }
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
        safeSend(ws, JSON.stringify({
          type: 'transcript',
          data: text,
          isFinal: true
        }), 'final transcript');
        
        console.log(`   [TRANSCRIPT] Transcriber state before LLM processing: ${t.isActive()}`);

        // Process complete utterance through LLM and TTS
        if (text.length > 5) { // Only process substantial text
          await handleTranscript(text, ws);
        }
        
        console.log(`   [TRANSCRIPT] Transcriber state after LLM processing: ${t.isActive()}`);
      } else {
        // Send interim results to client
        safeSend(ws, JSON.stringify({
          type: 'transcript',
          data: text,
          isFinal: false
        }), 'interim transcript');
      }
    });

    t.on('error', (error: Error) => {
      console.error('❌ [ERROR] Transcriber error:', error);
      safeSend(ws, JSON.stringify({
        type: 'error',
        message: 'Transcription error: ' + error.message
      }), 'transcriber error');
    });
    
    console.log('✅ [SETUP] Transcriber event handlers configured');
  };

  ws.on('message', async (message: Buffer | string) => {
    try {
      // CRITICAL: In ws library, ALL messages arrive as Buffers by default
      // We need to try parsing as JSON first, then fall back to treating as binary audio
      
      let messageStr: string;
      
      // Convert to string (handles both Buffer and string inputs)
      if (Buffer.isBuffer(message)) {
        messageStr = message.toString('utf8');
      } else {
        messageStr = message;
      }
      
      // Try to parse as JSON first
      let parsed: AudioMessage | null = null;
      let isJsonMessage = false;
      
      try {
        parsed = JSON.parse(messageStr);
        
        if (parsed && typeof parsed === 'object' && 'type' in parsed) {
          isJsonMessage = true;
          console.log(`✅ Parsed JSON message type: ${parsed.type}`);
          
          // Handle text_input message type
          if (parsed.type === 'text_input') {
            console.log(`🔍 [TEXT_INPUT] Entering text_input handler block`);
            console.log(`   Message value: "${parsed.message}"`);
            console.log(`   Message type: ${typeof parsed.message}`);
            console.log(`   Message trimmed length: ${parsed.message?.trim().length || 0}`);
            
            if (parsed.message && typeof parsed.message === 'string' && parsed.message.trim()) {
              console.log(`💬 [TEXT_INPUT] Processing text input: "${parsed.message}"`);
              
              try {
                // Skip STT - text is already provided
                const userText = parsed.message.trim();
                console.log(`🚀 [TEXT_INPUT] Starting LLM and TTS pipeline for: "${userText}"`);
                
                // --- Smart Context Selection ---
                console.log('🧠 Selecting relevant file context...');
                const userQueryText = userText.toLowerCase(); // Use lowercase for matching
                let relevantFileContext = '';
                let filesIncluded: string[] = [];

                // Simple keyword matching for filenames mentioned in the query
                for (const [filePath, cachedFile] of fileCache.entries()) {
                    // Extract filename from path for matching
                    const fileName = filePath.split(/[\\/]/).pop()?.toLowerCase(); 
                    if (fileName && userQueryText.includes(fileName)) {
                        console.log(`   ✅ Including context for mentioned file: ${filePath}`);
                        // Format context clearly for the LLM
                        relevantFileContext += `\n\n--- START FILE: ${filePath} ---\n${cachedFile.content}\n--- END FILE: ${filePath} ---\n`;
                        filesIncluded.push(filePath);
                    }
                }

                // Fallback: If no specific files mentioned, maybe include the *last* updated file?
                if (!relevantFileContext && fileCache.size > 0) {
                    console.log('   ⚠️ No specific files mentioned. Including last updated file as context.');
                    // This assumes fileCache iteration order might reflect insertion order (Map behavior)
                    const [lastFilePath, lastCachedFile] = Array.from(fileCache.entries()).pop()!; 
                    relevantFileContext = `\n\n--- START FILE: ${lastFilePath} ---\n${lastCachedFile.content}\n--- END FILE: ${lastFilePath} ---\n`;
                    filesIncluded.push(lastFilePath);
                } else if (!relevantFileContext) {
                    console.log('   ⚠️ No files mentioned and cache is empty. Proceeding without file context.');
                    relevantFileContext = '\n\n--- No file context available ---'; // Explicitly tell LLM
                }
                console.log(`   Context selection complete. Included ${filesIncluded.length} file(s).`);
                // --- End Smart Context Selection ---
                
                // Get LLM response with selected context
                const llmResponse = await getClaudeResponse(userText, relevantFileContext);
                console.log('✨ LLM response generated for text input');
                
                // Send text response to client
                safeSend(ws, JSON.stringify({
                  type: 'ai_response',
                  data: llmResponse
                }), 'AI response text');
                
                // Synthesize and stream TTS response
                let chunkCount = 0;
                for await (const chunk of synthesizeSpeechStream(llmResponse)) {
                  const sent = safeSend(ws, JSON.stringify({
                    type: 'audio',
                    data: chunk.toString('base64'),
                    format: 'mp3',
                    chunkIndex: chunkCount++
                  }), `audio chunk ${chunkCount}`);
                  
                  if (!sent) {
                    console.warn('WebSocket send failed, stopping audio stream');
                    break;
                  }
                }
                
                // Signal end of audio stream
                safeSend(ws, JSON.stringify({
                  type: 'audio_end',
                  totalChunks: chunkCount
                }), 'audio stream end');
                
                console.log('✅ Text input processed successfully');
                
              } catch (error) {
                console.error('❌ Error processing text input:', error);
                safeSend(ws, JSON.stringify({
                  type: 'error',
                  message: 'Failed to process text input: ' + (error instanceof Error ? error.message : 'Unknown error')
                }), 'text input error');
              }
            } else {
              console.warn('⚠️ Received text_input with empty or invalid message');
            }
            return;
          }
          
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
            
            safeSend(ws, JSON.stringify({
              type: 'recording_started'
            }), 'recording started');
          } catch (error) {
            console.error('❌ [START_RECORDING] Failed to start transcriber:', error);
            safeSend(ws, JSON.stringify({
              type: 'error',
              message: 'Failed to start recording: ' + (error instanceof Error ? error.message : 'Unknown error')
            }), 'start recording error');
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
              
              safeSend(ws, JSON.stringify({
                type: 'recording_stopped',
                fullTranscript
              }), 'recording stopped');
              fullTranscript = ''; // Reset
            } catch (error) {
              console.error('❌ [STOP_RECORDING] Error stopping transcriber:', error);
              safeSend(ws, JSON.stringify({
                type: 'error',
                message: 'Failed to stop recording: ' + (error instanceof Error ? error.message : 'Unknown error')
              }), 'stop recording error');
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
      }
      } catch (parseError) {
        // Not JSON or JSON parsing failed - treat as binary audio data
        isJsonMessage = false;
        console.log('📦 Message is not JSON, treating as binary audio data');
      }
      
      // If not a JSON message, treat as binary audio
      if (!isJsonMessage && Buffer.isBuffer(message)) {
        // Handle Buffer (audio data)
        const audioBuffer = message as Buffer;
        
        // **REFINED LOGIC:** Only forward if transcriber is ready AND session is active
        // This prevents spurious warnings when audio arrives before start_recording
        if (transcriber && transcriber.isActive() && transcriber.isConnectionReady() && isSessionActive) {
          // Send audio chunk to Deepgram
          // console.log(`📤 [AUDIO] Forwarding audio chunk: ${audioBuffer.length} bytes`);
          transcriber.sendAudio(audioBuffer);
        } else if (transcriber && isSessionActive) {
          // **ONLY LOG WARNING if session is active but transcriber isn't ready**
          // This avoids noise from audio data arriving before start_recording completes
          console.warn(`⚠️ [AUDIO] Session active but cannot forward audio:`);
          console.warn(`   • transcriber exists: ${transcriber !== null}`);
          console.warn(`   • transcriber.isActive(): ${transcriber?.isActive()}`);
          console.warn(`   • transcriber.isConnectionReady(): ${transcriber?.isConnectionReady()}`);
          console.warn(`   • sessionActive: ${isSessionActive}`);
        }
        // Silently ignore audio data if no session is active (normal during idle)
      }

    } catch (error) {
      console.error('❌ Error handling WebSocket message:', error);
      safeSend(ws, JSON.stringify({
        type: 'error',
        message: error instanceof Error ? error.message : 'Unknown error'
      }), 'message handler error');
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
  safeSend(ws, JSON.stringify({
    type: 'ready',
    message: 'WebSocket connection established'
  }), 'ready message');
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
      safeSend(ws, JSON.stringify({ type: 'session_ended' }), 'session ended');
      ws.close();
      break;
    case 'mute':
      safeSend(ws, JSON.stringify({ type: 'muted' }), 'muted');
      break;
    case 'unmute':
      safeSend(ws, JSON.stringify({ type: 'unmuted' }), 'unmuted');
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
    safeSend(ws, JSON.stringify({
      type: 'ai_response',
      data: aiResponse
    }), 'AI response');

    // Step 2: Synthesize speech (Fish Audio TTS)
    try {
      let chunkCount = 0;
      
      for await (const chunk of synthesizeSpeechStream(aiResponse)) {
        const sent = safeSend(ws, JSON.stringify({
          type: 'audio',
          data: chunk.toString('base64'),
          format: 'mp3',
          chunkIndex: chunkCount++
        }), `audio chunk ${chunkCount}`);
        
        if (!sent) {
          console.warn('WebSocket send failed, stopping audio stream');
          break;
        }
      }

      // Signal end of audio stream
      safeSend(ws, JSON.stringify({
        type: 'audio_end',
        totalChunks: chunkCount
      }), 'audio end');
      
    } catch (ttsError) {
      console.error('TTS Error:', ttsError);
      safeSend(ws, JSON.stringify({
        type: 'error',
        message: 'Failed to generate speech: ' + (ttsError instanceof Error ? ttsError.message : 'Unknown error')
      }), 'TTS error');
    }
    
  } catch (error) {
    console.error('Error handling transcript:', error);
    safeSend(ws, JSON.stringify({
      type: 'error',
      message: error instanceof Error ? error.message : 'Unknown error'
    }), 'transcript handler error');
  }
}
