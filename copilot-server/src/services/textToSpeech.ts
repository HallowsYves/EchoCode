import axios from 'axios';
import { EventEmitter } from 'events';
import WebSocket from 'ws';

// TODO: Set FISH_AUDIO_API_KEY environment variable in .env file
const fishAudioApiKey = process.env.FISH_AUDIO_API_KEY || '';
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
    if (!fishAudioApiKey) {
      throw new Error('FISH_AUDIO_API_KEY not configured in environment variables');
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
  try {
    if (!fishAudioApiKey) {
      console.warn('Fish Audio API key not configured, returning empty audio');
      throw new Error('FISH_AUDIO_API_KEY not configured');
    }

    // Fish Audio TTS endpoint - adjust based on actual API documentation
    const response = await axios.post(
      `${fishAudioApiUrl}/tts`,
      {
        text,
        reference_id: 'default_voice', // Use appropriate voice ID
        format: 'mp3',
        mp3_bitrate: 128,
        normalize: true,
        opus_bitrate: -1000,
        latency: 'normal', // or 'optimized' for faster streaming
      },
      {
        headers: {
          'Authorization': `Bearer ${fishAudioApiKey}`,
          'Content-Type': 'application/json',
        },
        responseType: 'stream',
      }
    );

    // Stream audio chunks as they arrive
    for await (const chunk of response.data) {
      if (chunk && chunk.length > 0) {
        yield chunk as Buffer;
      }
    }
    
  } catch (error) {
    console.error('Error synthesizing speech:', error);
    
    if (axios.isAxiosError(error)) {
      console.error('Fish Audio API Error:', error.response?.data);
      throw new Error(
        `Fish Audio API error: ${error.response?.status} - ${JSON.stringify(error.response?.data)}`
      );
    }
    
    throw error;
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
  try {
    if (!fishAudioApiKey) {
      throw new Error('Fish Audio API key not configured');
    }

    const response = await axios.get(`${fishAudioApiUrl}/voices`, {
      headers: {
        'Authorization': `Bearer ${fishAudioApiKey}`,
      },
    });

    return response.data;
  } catch (error) {
    console.error('Error fetching Fish Audio voices:', error);
    throw error;
  }
}
