import axios from 'axios';

// TODO: Configure Fish Audio API key and URL from environment variables
const fishAudioApiKey = process.env.FISH_AUDIO_API_KEY || '';
const fishAudioApiUrl = process.env.FISH_AUDIO_API_URL || 'https://api.fish.audio/v1';

/**
 * Synthesize speech from text using Fish Audio API
 * @param text Text to convert to speech
 * @returns Async generator yielding audio chunks
 */
export async function* synthesizeSpeechStream(text: string): AsyncGenerator<Buffer> {
  try {
    if (!fishAudioApiKey) {
      console.warn('Fish Audio API key not configured, returning mock audio');
      // TODO: Remove mock response after API key is configured
      yield Buffer.from('[Mock audio data - Configure FISH_AUDIO_API_KEY]');
      return;
    }

    // TODO: Implement actual Fish Audio API integration
    // This is a placeholder implementation
    
    // Fish Audio API typically supports streaming TTS
    // You'll need to:
    // 1. Send POST request to TTS endpoint
    // 2. Stream the response audio chunks
    // 3. Yield each chunk as it arrives

    const response = await axios.post(
      `${fishAudioApiUrl}/tts`,
      {
        text,
        // TODO: Configure voice settings
        voice: 'default',
        format: 'mp3', // or 'wav', 'pcm'
        sample_rate: 24000,
      },
      {
        headers: {
          'Authorization': `Bearer ${fishAudioApiKey}`,
          'Content-Type': 'application/json',
        },
        responseType: 'stream',
      }
    );

    // Stream audio chunks
    for await (const chunk of response.data) {
      yield chunk as Buffer;
    }
    
  } catch (error) {
    console.error('Error synthesizing speech:', error);
    
    if (axios.isAxiosError(error)) {
      console.error('API Error:', error.response?.data);
      throw new Error(`Fish Audio API error: ${error.response?.status} ${error.response?.statusText}`);
    }
    
    throw error;
  }
}

/**
 * Synthesize speech and return complete audio buffer (non-streaming)
 * Useful for smaller text chunks
 */
export async function synthesizeSpeech(text: string): Promise<Buffer> {
  const chunks: Buffer[] = [];
  
  for await (const chunk of synthesizeSpeechStream(text)) {
    chunks.push(chunk);
  }
  
  return Buffer.concat(chunks);
}

/**
 * Get available voices from Fish Audio
 * TODO: Implement voice selection feature
 */
export async function getAvailableVoices() {
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
    console.error('Error fetching voices:', error);
    throw error;
  }
}
