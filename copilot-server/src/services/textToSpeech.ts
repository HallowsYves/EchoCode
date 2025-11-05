import axios from 'axios';
import { EventEmitter } from 'events';
import WebSocket from 'ws';

// IMPORTANT: Set FISH_AUDIO_API_KEY environment variable in .env file
// The API key must be valid and associated with an active Fish Audio account
const fishAudioApiKey = process.env.FISH_AUDIO_API_KEY;
const fishAudioApiUrl = process.env.FISH_AUDIO_API_URL || 'https://api.fish.audio/v1';

/**
 * Fish Audio TTS Streamer
 * Handles real-time text-to-speech conversion with streaming audio output
 */
export class FishAudioSynthesizer extends EventEmitter {
  private ws: WebSocket | null = null;
  private isConnected: boolean = false;

  constructor() {
    super();
  }

  /**
   * Start a TTS streaming session
   * Note: Fish Audio's actual API structure may vary - adjust endpoint/protocol as needed
   */
  async connect(): Promise<void> {
    if (!fishAudioApiKey || fishAudioApiKey.trim() === '') {
      throw new Error('FISH_AUDIO_API_KEY environment variable is not set or is empty.');
    }

    try {
      // Note: Adjust WebSocket endpoint based on Fish Audio's actual API
      // If Fish Audio doesn't support WebSocket, we'll use the HTTP streaming approach below
      const wsUrl = `wss://api.fish.audio/v1/tts/stream?api_key=${fishAudioApiKey}`;
      
      this.ws = new WebSocket(wsUrl);

      this.ws.on('open', () => {
        console.log('Fish Audio TTS connection opened');
        this.isConnected = true;
        this.emit('open');
      });

      this.ws.on('message', (data: Buffer) => {
        // Emit audio chunks as they arrive
        this.emit('audio', data);
      });

      this.ws.on('error', (error: Error) => {
        console.error('Fish Audio WebSocket error:', error);
        this.emit('error', error);
      });

      this.ws.on('close', () => {
        console.log('Fish Audio TTS connection closed');
        this.isConnected = false;
        this.emit('close');
      });

    } catch (error) {
      console.error('Failed to connect to Fish Audio TTS:', error);
      throw error;
    }
  }

  /**
   * Send text to be synthesized
   */
  synthesize(text: string, options?: { voice?: string; speed?: number }): void {
    if (!this.ws || !this.isConnected) {
      console.warn('Fish Audio not connected');
      return;
    }

    const payload = {
      text,
      voice: options?.voice || 'default',
      speed: options?.speed || 1.0,
      format: 'pcm',
      sample_rate: 24000,
    };

    this.ws.send(JSON.stringify(payload));
  }

  /**
   * Close the TTS connection
   */
  async close(): Promise<void> {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
      this.isConnected = false;
    }
  }

  /**
   * Check if connected
   */
  isActive(): boolean {
    return this.isConnected;
  }
}

/**
 * HTTP-based streaming TTS (fallback if WebSocket not supported)
 * This is more likely the actual Fish Audio API structure
 * @param text Text to convert to speech
 * @returns Async generator yielding audio chunks
 */
export async function* synthesizeSpeechStream(text: string): AsyncGenerator<Buffer> {
  // Validate API key before making any requests
  if (!fishAudioApiKey || fishAudioApiKey.trim() === '') {
    const error = new Error('FISH_AUDIO_API_KEY environment variable is not set or is empty.');
    console.error(`
--------------------------------------------------------------
FISH AUDIO API ERROR: Missing API Key
The FISH_AUDIO_API_KEY environment variable is required.
Please:
1. Sign up or log in at https://fish.audio
2. Generate an API key from your account dashboard
3. Add it to your .env file: FISH_AUDIO_API_KEY=your_key_here
--------------------------------------------------------------
`);
    throw error;
  }

  try {

    // Fish Audio TTS endpoint - Using minimal valid parameters
    // NOTE: reference_id should be a valid voice UUID from your Fish Audio account
    // If omitted, Fish Audio will use the default voice
    // For available voices, call getAvailableVoices() or check your Fish Audio dashboard
    const requestPayload = {
      text,
      // reference_id: 'your-voice-uuid-here', // Omitting to use default voice
      format: 'mp3', // Supported formats: mp3, wav, pcm, opus
      mp3_bitrate: 128, // 128 or 192 kbps for mp3 format
      latency: 'normal', // 'normal' or 'balanced' for streaming
    };
    
    console.log('🎵 Sending TTS request to Fish Audio...');
    console.log('   Text length:', text.length, 'characters');
    console.log('   Payload:', JSON.stringify(requestPayload, null, 2));
    
    const response = await axios.post(
      `${fishAudioApiUrl}/tts`,
      requestPayload,
      {
        headers: {
          'Authorization': `Bearer ${fishAudioApiKey}`,
          'Content-Type': 'application/json',
        },
        responseType: 'stream',
        timeout: 30000, // 30 second timeout for the initial request
      }
    );

    // CRITICAL: Attach error handlers to the response stream to prevent ETIMEDOUT crashes
    const audioStream = response.data;
    
    // Track if we've started receiving data
    let hasReceivedData = false;
    let chunkCount = 0;
    
    // Attach error handler to prevent uncaught stream errors
    audioStream.on('error', (streamError: Error) => {
      console.error('❌ [TTS Stream Error] Error in Fish Audio response stream:', streamError);
      console.error('   Error name:', streamError.name);
      console.error('   Error message:', streamError.message);
      console.error('   Chunks received before error:', chunkCount);
      console.error('   Had received data:', hasReceivedData);
      
      // Don't throw - let the generator complete naturally
      // The for-await loop will handle the stream ending
    });
    
    // Handle stream end
    audioStream.on('end', () => {
      console.log('✅ [TTS Stream] Fish Audio stream ended normally');
      console.log('   Total chunks received:', chunkCount);
    });
    
    // Handle stream close
    audioStream.on('close', () => {
      console.log('🔒 [TTS Stream] Fish Audio stream closed');
    });
    
    // Stream audio chunks as they arrive with error handling
    try {
      for await (const chunk of audioStream) {
        if (chunk && chunk.length > 0) {
          hasReceivedData = true;
          chunkCount++;
          
          // Log first chunk for debugging
          if (chunkCount === 1) {
            console.log('🎵 [TTS Stream] First chunk received:', chunk.length, 'bytes');
            // Log first 16 bytes to verify format
            const preview = chunk.slice(0, Math.min(16, chunk.length));
            const previewBytes = Array.from(preview) as number[];
            console.log('   First bytes (hex):', previewBytes.map(b => b.toString(16).padStart(2, '0')).join(' '));
          }
          
          yield chunk as Buffer;
        }
      }
      
      console.log('✅ [TTS Stream] Completed streaming', chunkCount, 'chunks');
      
    } catch (iterationError) {
      console.error('❌ [TTS Stream] Error during stream iteration:', iterationError);
      console.error('   Chunks streamed before error:', chunkCount);
      
      // Re-throw if this is a network error we should propagate
      if (iterationError instanceof Error && iterationError.message.includes('ETIMEDOUT')) {
        console.error('❌ [TTS Stream] ETIMEDOUT error detected - connection timed out during streaming');
        // Don't crash - just log and complete the generator
      } else {
        // For other errors, we might want to propagate them
        throw iterationError;
      }
    }
    
  } catch (error: any) {
    console.error('❌ Error synthesizing speech:', error.message || error);
    
    // Log request details for debugging
    if (axios.isAxiosError(error)) {
      console.error('\n📤 Request Details:');
      console.error('   URL:', error.config?.url);
      console.error('   Method:', error.config?.method?.toUpperCase());
      console.error('   Payload:', error.config?.data);
      console.error('   Headers:', {
        ...error.config?.headers,
        Authorization: error.config?.headers?.Authorization ? '***REDACTED***' : undefined
      });
    }
    
    if (axios.isAxiosError(error) && error.response) {
      const status = error.response.status;
      const statusText = error.response.statusText;
      const apiKeyLast4 = fishAudioApiKey.slice(-4);
      
      // Handle specific HTTP error codes
      if (status === 402) {
        console.error(`
--------------------------------------------------------------
FISH AUDIO API ERROR: 402 Payment Required

This usually means:
• Your Fish Audio API key is invalid or expired
• Your account has insufficient credits or balance
• Your billing information is not set up correctly
• Your account is on a free tier that has reached its limit

API Key Used (last 4 chars): ...${apiKeyLast4}

Please:
1. Log in to your Fish Audio account at https://fish.audio
2. Verify your API key is correct and active
3. Check your account's billing status and credit balance
4. Ensure you have an active subscription or sufficient credits
5. Generate a new API key if needed

Full Error Details:
Status: ${status} ${statusText}
Response: ${JSON.stringify(error.response.data, null, 2)}
--------------------------------------------------------------
`);
        throw new Error('Fish Audio: Payment Required (402) - Please check your API key and account billing status');
      }
      
      if (status === 401) {
        console.error(`
--------------------------------------------------------------
FISH AUDIO API ERROR: 401 Unauthorized

Your API key is invalid or has been revoked.
API Key Used (last 4 chars): ...${apiKeyLast4}

Please:
1. Verify your API key at https://fish.audio
2. Generate a new API key if needed
3. Update your .env file with the correct key
--------------------------------------------------------------
`);
        throw new Error('Fish Audio: Unauthorized (401) - Invalid API key');
      }
      
      if (status === 400) {
        console.error(`
--------------------------------------------------------------
FISH AUDIO API ERROR: 400 Bad Request

The request parameters are invalid or malformed.
`);
        
        // Safely log response data (might be object or string)
        try {
          const responseData = typeof error.response.data === 'string' 
            ? error.response.data 
            : JSON.stringify(error.response.data, null, 2);
          console.error('Response Data:', responseData);
        } catch (e) {
          console.error('Response Data: [Could not serialize response]');
        }
        
        console.error(`
Common causes:
• Invalid or missing 'reference_id' (voice UUID)
• Unsupported parameter values (e.g., invalid bitrate)
• Text is empty or too long
• Invalid format specified

Please check:
• Use a valid voice UUID for 'reference_id' or omit it for default voice
• Remove any unsupported parameters (e.g., opus_bitrate for mp3 format)
• Verify all parameters match the Fish Audio API documentation
• Call getAvailableVoices() to see valid voice IDs
--------------------------------------------------------------
`);
        throw new Error(`Fish Audio: Bad Request (400) - Invalid request parameters. ${error.response.data?.error || ''}`);
      }
      
      if (status >= 500) {
        console.error(`
--------------------------------------------------------------
FISH AUDIO API ERROR: ${status} Server Error

Fish Audio's servers are experiencing issues.
This is not a problem with your configuration.

Please:
• Wait a few minutes and try again
• Check Fish Audio's status page for known issues
--------------------------------------------------------------
`);
        throw new Error(`Fish Audio: Server Error (${status})`);
      }
      
      // Generic error for other status codes
      console.error(`\nFish Audio API Error (${status} ${statusText})`);
      
      // Safely log response data
      try {
        const responseData = typeof error.response.data === 'string'
          ? error.response.data
          : JSON.stringify(error.response.data, null, 2);
        console.error('Response:', responseData);
      } catch (e) {
        console.error('Response: [Could not serialize]');
      }
      
      const errorMessage = error.response.data?.error || error.response.data?.message || statusText;
      throw new Error(`Fish Audio API error: ${status} - ${errorMessage}`);
    }
    
    // Handle non-Axios errors (network issues, etc.)
    if (axios.isAxiosError(error) && error.request && !error.response) {
      console.error('\n❌ Network Error: No response received from Fish Audio API');
      console.error('   This could indicate:');
      console.error('   • Network connectivity issues');
      console.error('   • Fish Audio API is down');
      console.error('   • Request timeout');
      console.error('   • CORS or firewall blocking the request');
      throw new Error('Fish Audio: Network error - No response received');
    }
    
    // Unknown error
    throw new Error(`Fish Audio TTS failed: ${error.message || 'Unknown error'}`);
  }
}

/**
 * Synthesize speech and return complete audio buffer (non-streaming)
 * Useful for smaller text chunks - trades latency for simplicity
 */
export async function synthesizeSpeech(text: string): Promise<Buffer> {
  const chunks: Buffer[] = [];
  
  try {
    for await (const chunk of synthesizeSpeechStream(text)) {
      chunks.push(chunk);
    }
    
    return Buffer.concat(chunks);
  } catch (error) {
    console.error('Error in synthesizeSpeech:', error);
    throw error;
  }
}

/**
 * Get available voices from Fish Audio
 */
export async function getAvailableVoices(): Promise<any> {
  // Validate API key before making any requests
  if (!fishAudioApiKey || fishAudioApiKey.trim() === '') {
    throw new Error('FISH_AUDIO_API_KEY environment variable is not set or is empty.');
  }
  
  try {

    const response = await axios.get(`${fishAudioApiUrl}/voices`, {
      headers: {
        'Authorization': `Bearer ${fishAudioApiKey}`,
      },
    });

    return response.data;
  } catch (error) {
    console.error('Error fetching Fish Audio voices:', error);
    
    if (axios.isAxiosError(error) && error.response) {
      const status = error.response.status;
      const apiKeyLast4 = fishAudioApiKey.slice(-4);
      
      if (status === 402) {
        console.error(`
--------------------------------------------------------------
FISH AUDIO API ERROR: 402 Payment Required
API Key (last 4 chars): ...${apiKeyLast4}
Please check your Fish Audio account billing status.
--------------------------------------------------------------
`);
        throw new Error('Fish Audio: Payment Required (402)');
      }
      
      if (status === 401) {
        console.error(`Fish Audio API: Unauthorized (401) - Invalid API key ...${apiKeyLast4}`);
        throw new Error('Fish Audio: Unauthorized (401)');
      }
    }
    
    throw error;
  }
}
