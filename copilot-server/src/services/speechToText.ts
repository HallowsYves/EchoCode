import { createClient, LiveTranscriptionEvents, LiveClient } from '@deepgram/sdk';
import { EventEmitter } from 'events';

// CRITICAL: DEEPGRAM_API_KEY must be set in .env.local file
// The API key is validated before each client creation
const deepgramApiKey = process.env.DEEPGRAM_API_KEY;

let deepgramClient: ReturnType<typeof createClient> | null = null;

/**
 * Initialize Deepgram client
 * Performs strict validation of API key before creation
 */
function getDeepgramClient() {
  // Strict API key validation
  if (!deepgramApiKey || deepgramApiKey.trim() === '') {
    console.error('\n--------------------------------------------------------------');
    console.error('FATAL ERROR: DEEPGRAM_API_KEY environment variable is not set or empty.');
    console.error('Please:');
    console.error('1. Check that you have a .env.local file in copilot-server/');
    console.error('2. Add: DEEPGRAM_API_KEY=your_key_here');
    console.error('3. Restart the server');
    console.error('--------------------------------------------------------------\n');
    return null;
  }
  
  if (!deepgramClient) {
    console.log('🔄 Attempting to create Deepgram client...');
    console.log(`   API Key (first 8/last 4 chars): ${deepgramApiKey.slice(0, 8)}...${deepgramApiKey.slice(-4)}`);
    
    try {
      deepgramClient = createClient(deepgramApiKey);
      console.log('✅ Deepgram client created successfully');
    } catch (error) {
      console.error('❌ Failed to create Deepgram client:', error);
      return null;
    }
  }
  
  return deepgramClient;
}

/**
 * Live transcription session manager
 * Handles streaming audio to Deepgram and emitting transcript results
 */
export class DeepgramTranscriber extends EventEmitter {
  private connection: LiveClient | null = null;
  private isConnected: boolean = false;
  private isStarting: boolean = false;
  private isStopping: boolean = false;
  private connectionOpenPromise: Promise<void> | null = null;

  constructor() {
    super();
    console.log('🎤 DeepgramTranscriber instance created');
  }

  /**
   * Start a live transcription session (IDEMPOTENT)
   * Safe to call multiple times - will not create duplicate connections
   * Waits for connection to open before resolving
   */
  async start(): Promise<void> {
    console.log('🎤 [START] Attempting to start Deepgram transcriber...');
    console.log(`   Current state: isConnected=${this.isConnected}, isStarting=${this.isStarting}, connection=${this.connection !== null}`);
    
    // IDEMPOTENCY CHECK: Already connected
    if (this.isConnected && this.connection) {
      console.log('✅ [START] Already connected and active - skipping start');
      return;
    }
    
    // IDEMPOTENCY CHECK: Already starting
    if (this.isStarting) {
      console.log('⏳ [START] Start already in progress - waiting for completion...');
      if (this.connectionOpenPromise) {
        await this.connectionOpenPromise;
        console.log('✅ [START] Existing start operation completed');
        return;
      }
      // If no promise exists but isStarting is true, something is wrong
      console.warn('⚠️ [START] isStarting=true but no promise - resetting flag');
      this.isStarting = false;
    }
    
    // Mark as starting
    this.isStarting = true;
    console.log('🔄 [START] Setting isStarting=true');
    
    const client = getDeepgramClient();
    
    if (!client) {
      this.isStarting = false;
      const errorMsg = 'DEEPGRAM_API_KEY not configured or invalid - Cannot start transcription';
      console.error(`❌ [START] ${errorMsg}`);
      throw new Error(errorMsg);
    }
    
    console.log('✅ [START] Deepgram client obtained, proceeding with connection...');

    try {
      console.log('🔄 Initiating Deepgram connection...');
      
      // Create live transcription connection
      this.connection = client.listen.live({
        model: 'nova-2',
        language: 'en',
        smart_format: true,
        punctuate: true,
        interim_results: true,
        endpointing: 300, // ms of silence before considering utterance complete
        // encoding and sample_rate auto-detected by Deepgram
      });

      // Create promise that resolves when connection opens
      this.connectionOpenPromise = new Promise<void>((resolve, reject) => {
        let isResolved = false;
        
        // Timeout for connection
        const timeoutId = setTimeout(() => {
          if (!isResolved && !this.isConnected) {
            console.error('❌ [START] Deepgram connection timeout (5s)');
            this.isStarting = false;
            isResolved = true;
            reject(new Error('Deepgram connection timeout'));
          }
        }, 5000);
        
        // Open handler - only resolve promise here
        const openHandler = () => {
          console.log('✅ [START] Deepgram connection opened successfully');
          console.log('   [STATE CHANGE] isConnected: false → true, isStarting: true → false');
          this.isConnected = true;
          this.isStarting = false;
          
          if (!isResolved) {
            clearTimeout(timeoutId);
            isResolved = true;
            resolve();
          }
          this.emit('open');
        };
        
        // Error handler - reject promise if during connection phase
        const errorHandler = (error: any) => {
          console.error('❌ [ERROR] Deepgram error event handler triggered:', error);
          console.log(`   [STATE CHANGE] isConnected: ${this.isConnected} → false`);
          console.log('   Error details:', JSON.stringify(error, null, 2));
          this.isConnected = false;
          this.emit('error', error);
          
          // Only reject promise during initial connection
          if (!isResolved) {
            console.log('   [ERROR] Error occurred during start - rejecting promise and clearing isStarting');
            this.isStarting = false;
            clearTimeout(timeoutId);
            isResolved = true;
            reject(error);
          }
        };
        
        if (!this.connection) {
          reject(new Error('Failed to create Deepgram connection'));
          return;
        }
        
        this.connection.on(LiveTranscriptionEvents.Open, openHandler);
        this.connection.on(LiveTranscriptionEvents.Error, errorHandler);
      });
      
      // Set up remaining event handlers (not part of connection promise)
      this.connection.on(LiveTranscriptionEvents.Transcript, (data: any) => {
        // Log state BEFORE processing to catch corruption
        console.log(`📝 Transcript event received (isConnected: ${this.isConnected})`);
        
        const transcript = data.channel?.alternatives?.[0]?.transcript;
        const isFinal = data.is_final;

        if (transcript && transcript.length > 0) {
          if (isFinal) {
            console.log(`✅ Final transcript: "${transcript}"`);
            this.emit('transcript', transcript, true);
          } else {
            console.log(`⏳ Interim transcript: "${transcript}"`);
            this.emit('transcript', transcript, false);
          }
        } else {
          console.log('⚠️ Empty transcript in event');
        }
        
        // Log state AFTER processing to detect corruption
        console.log(`   [STATE CHECK AFTER TRANSCRIPT] isConnected: ${this.isConnected}`);
        
        // CRITICAL: Transcript event should NEVER change state
        // If this log shows false, we have a bug
      });

      this.connection.on(LiveTranscriptionEvents.Close, () => {
        console.log('🔌 [CLOSE] Deepgram close event handler triggered.');
        console.log(`   [STATE CHANGE] isConnected: ${this.isConnected} → false, isStarting: ${this.isStarting} → false`);
        console.log('   Reason: Close event received from Deepgram');
        this.isConnected = false;
        this.isStarting = false; // Clear in case connection closed during start
        this.isStopping = false; // Clear stopping flag
        this.emit('close');
      });

      this.connection.on(LiveTranscriptionEvents.Metadata, (data: any) => {
        console.log(`📊 Deepgram metadata event (isConnected: ${this.isConnected})`);
        if (data.channels) console.log(`   Channels: ${data.channels}`);
        if (data.models) console.log(`   Models: ${data.models}`);
        if (data.duration) console.log(`   Duration: ${data.duration}s`);
        
        // CRITICAL: Metadata should NEVER change state
        console.log(`   [STATE CHECK AFTER METADATA] isConnected: ${this.isConnected}`);
      });
      
      // Wait for connection to open before returning
      await this.connectionOpenPromise;
      console.log('✅ [START] start() returning - connection ready');
      console.log(`   Final state: isConnected=${this.isConnected}, isStarting=${this.isStarting}`);
      
    } catch (error) {
      console.error('❌ [START] Failed to start Deepgram transcription:', error);
      this.isConnected = false;
      this.isStarting = false;
      this.connection = null;
      this.connectionOpenPromise = null;
      throw error;
    }
  }

  /**
   * Send audio chunk to Deepgram for transcription
   */
  sendAudio(audioChunk: Buffer): void {
    // Check both flag and actual connection state
    if (!this.connection) {
      console.warn('⚠️ Cannot send audio: No connection instance');
      return;
    }
    
    if (!this.isConnected) {
      console.warn('⚠️ Cannot send audio: isConnected flag is false');
      return;
    }
    
    // Verify connection is actually open (readyState check)
    try {
      const readyState = (this.connection as any).getReadyState?.();
      if (readyState && readyState !== 1) { // 1 = OPEN
        console.warn(`⚠️ Cannot send audio: Connection readyState = ${readyState} (expected 1)`);
        this.isConnected = false; // Update state to match reality
        return;
      }
    } catch (e) {
      // getReadyState might not exist, continue
    }

    try {
      // Convert Buffer to ArrayBuffer for WebSocket compatibility
      const arrayBuffer = audioChunk.buffer.slice(
        audioChunk.byteOffset,
        audioChunk.byteOffset + audioChunk.byteLength
      );
      this.connection.send(arrayBuffer);
    } catch (error) {
      console.error('❌ Error sending audio to Deepgram:', error);
      this.isConnected = false; // Update state on send failure
      this.emit('error', error);
    }
  }

  /**
   * Flush any remaining audio and close the connection (IDEMPOTENT)
   * Safe to call multiple times - will not error if already stopped
   */
  async stop(): Promise<void> {
    console.log('🛑 [STOP] stop() method called on DeepgramTranscriber.');
    console.log(`   Current state: isConnected=${this.isConnected}, isStarting=${this.isStarting}, isStopping=${this.isStopping}, connection=${this.connection !== null}`);
    
    // IDEMPOTENCY CHECK: Already stopped
    if (!this.connection && !this.isConnected && !this.isStarting) {
      console.log('✅ [STOP] Already stopped - nothing to do');
      return;
    }
    
    // IDEMPOTENCY CHECK: Already stopping
    if (this.isStopping) {
      console.log('⏳ [STOP] Stop already in progress - skipping');
      return;
    }
    
    // Mark as stopping
    this.isStopping = true;
    console.log('🔄 [STOP] Setting isStopping=true');
    
    // Force state to disconnected immediately to prevent audio forwarding during shutdown
    console.log('🔒 [STOP] Setting isConnected=false immediately (before close)');
    this.isConnected = false;
    this.isStarting = false; // Cancel any pending start
    
    if (this.connection) {
      try {
        console.log('📤 [STOP] Sending finish() to Deepgram...');
        // Send keepalive to finalize any pending transcripts
        this.connection.finish();
        
        // Wait a bit for close event to fire naturally
        await new Promise(resolve => setTimeout(resolve, 100));
        
        console.log('✅ [STOP] Connection finish() completed');
      } catch (error) {
        console.error('❌ [STOP] Error closing Deepgram connection:', error);
        // State already set to false above
      }
      this.connection = null;
      this.connectionOpenPromise = null;
    }
    
    this.isStopping = false;
    console.log('✅ [STOP] Transcriber stopped successfully');
    console.log(`   Final state: isConnected=${this.isConnected}, isStarting=${this.isStarting}, isStopping=${this.isStopping}`);
  }

  /**
   * Check if transcriber is connected
   */
  isActive(): boolean {
    const active = this.isConnected && this.connection !== null;
    return active;
  }

  /**
   * Check if connection is ready to send audio
   * Verifies both the isConnected flag AND the actual WebSocket ready state
   */
  isConnectionReady(): boolean {
    if (!this.connection || !this.isConnected) {
      return false;
    }
    
    try {
      // Check WebSocket ready state (1 = OPEN)
      const readyState = (this.connection as any).getReadyState?.();
      if (readyState !== undefined && readyState !== 1) {
        console.warn(`⚠️ Connection readyState mismatch: flag=${this.isConnected}, readyState=${readyState} (expected 1)`);
        return false;
      }
      return true;
    } catch (e) {
      // getReadyState might not exist, fall back to isConnected check
      return this.isConnected;
    }
  }
}

/**
 * Simple one-off transcription for pre-recorded audio (fallback)
 * @param audioData Audio buffer
 * @returns Transcribed text
 */
export async function transcribeAudioFile(audioData: Buffer): Promise<string> {
  try {
    const client = getDeepgramClient();
    
    if (!client) {
      throw new Error('Deepgram API key not configured');
    }

    const { result, error } = await client.listen.prerecorded.transcribeFile(
      audioData,
      {
        model: 'nova-2',
        language: 'en',
        smart_format: true,
        punctuate: true,
      }
    );

    if (error) {
      console.error('Deepgram transcription error:', error);
      throw new Error(`Transcription failed: ${error.message}`);
    }

    const transcript = result?.results?.channels[0]?.alternatives[0]?.transcript || '';
    return transcript;
    
  } catch (error) {
    console.error('Error in transcribeAudioFile:', error);
    throw error;
  }
}
