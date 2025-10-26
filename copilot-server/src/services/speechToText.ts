import { createClient, LiveTranscriptionEvents, LiveClient } from '@deepgram/sdk';
import { EventEmitter } from 'events';

// TODO: Set DEEPGRAM_API_KEY environment variable in .env file
const deepgramApiKey = process.env.DEEPGRAM_API_KEY || '';

let deepgramClient: ReturnType<typeof createClient> | null = null;

/**
 * Initialize Deepgram client
 */
function getDeepgramClient() {
  if (!deepgramClient && deepgramApiKey) {
    deepgramClient = createClient(deepgramApiKey);
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
  private connectionOpenPromise: Promise<void> | null = null;

  constructor() {
    super();
  }

  /**
   * Start a live transcription session
   * Waits for connection to open before resolving
   */
  async start(): Promise<void> {
    const client = getDeepgramClient();
    
    if (!client) {
      console.error('Deepgram API key not configured');
      throw new Error('DEEPGRAM_API_KEY not configured in environment variables');
    }

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
            console.error('❌ Deepgram connection timeout (5s)');
            isResolved = true;
            reject(new Error('Deepgram connection timeout'));
          }
        }, 5000);
        
        // Open handler - only resolve promise here
        const openHandler = () => {
          console.log('✅ Deepgram connection opened successfully');
          console.log('   [STATE CHANGE] isConnected: false → true');
          this.isConnected = true;
          
          if (!isResolved) {
            clearTimeout(timeoutId);
            isResolved = true;
            resolve();
          }
          this.emit('open');
        };
        
        // Error handler - reject promise if during connection phase
        const errorHandler = (error: any) => {
          console.error('❌ Deepgram error event:', error);
          console.log(`   [STATE CHANGE] isConnected: ${this.isConnected} → false`);
          this.isConnected = false;
          this.emit('error', error);
          
          // Only reject promise during initial connection
          if (!isResolved) {
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
        console.log('🔌 Deepgram close event received');
        console.log(`   [STATE CHANGE] isConnected: ${this.isConnected} → false`);
        this.isConnected = false;
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
      console.log('✅ start() returning - connection ready');
      
    } catch (error) {
      console.error('❌ Failed to start Deepgram transcription:', error);
      this.isConnected = false;
      this.connection = null;
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
   * Flush any remaining audio and close the connection
   */
  async stop(): Promise<void> {
    console.log('🛑 Stopping Deepgram transcriber...');
    
    if (this.connection) {
      try {
        // Send keepalive to finalize any pending transcripts
        this.connection.finish();
        
        // Wait a bit for close event to fire naturally
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // Force state update if close event didn't fire
        if (this.isConnected) {
          console.log('   Force setting isConnected = false');
          this.isConnected = false;
        }
      } catch (error) {
        console.error('❌ Error closing Deepgram connection:', error);
        this.isConnected = false;
      }
      this.connection = null;
    }
    
    console.log('✅ Transcriber stopped');
  }

  /**
   * Check if transcriber is connected
   */
  isActive(): boolean {
    const active = this.isConnected && this.connection !== null;
    return active;
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
