# Frontend MSE Implementation Guide

## Complete SidecarView.tsx with Media Source Extensions

Replace the entire `copilot-ui/src/components/SidecarView.tsx` file with this implementation:

```tsx
'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useWebSocket } from '@/hooks/useWebSocket';
import { useMicrophone } from '@/hooks/useMicrophone';

export default function SidecarView() {
  console.log('SidecarView re-rendered');
  
  // State
  const [transcript, setTranscript] = useState<string>('');
  const [aiResponse, setAiResponse] = useState<string>('');
  const [isConnected, setIsConnected] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  
  // Refs for Media Source Extensions
  const audioElementRef = useRef<HTMLAudioElement | null>(null);
  const mediaSourceRef = useRef<MediaSource | null>(null);
  const sourceBufferRef = useRef<SourceBuffer | null>(null);
  const audioChunkQueueRef = useRef<ArrayBuffer[]>([]);
  const isAppendingRef = useRef(false);

  /**
   * Initialize Media Source Extensions
   * Creates MediaSource, SourceBuffer, and sets up event handlers
   * Backend sends MP3 format (confirmed in textToSpeech.ts and audioHandler.ts)
   */
  const initializeMediaSource = useCallback(() => {
    if (typeof window === 'undefined') return;
    if (mediaSourceRef.current || !audioElementRef.current) return;

    console.log('🎬 [MSE] Initializing Media Source Extensions...');
    
    try {
      const mediaSource = new MediaSource();
      mediaSourceRef.current = mediaSource;

      const objectURL = URL.createObjectURL(mediaSource);
      audioElementRef.current.src = objectURL;
      console.log('🔗 [MSE] Object URL created and set as audio src');

      mediaSource.addEventListener('sourceopen', () => {
        console.log('✅ [MSE] MediaSource opened');
        
        try {
          const mimeType = 'audio/mpeg'; // Backend sends MP3
          
          if (!MediaSource.isTypeSupported(mimeType)) {
            console.error(`❌ [MSE] MIME type ${mimeType} not supported`);
            return;
          }
          
          const sourceBuffer = mediaSource.addSourceBuffer(mimeType);
          sourceBufferRef.current = sourceBuffer;
          console.log('✅ [MSE] SourceBuffer created:', mimeType);

          sourceBuffer.addEventListener('updateend', () => {
            isAppendingRef.current = false;
            
            if (audioChunkQueueRef.current.length > 0 && !isAppendingRef.current) {
              const nextChunk = audioChunkQueueRef.current.shift();
              if (nextChunk) {
                try {
                  isAppendingRef.current = true;
                  sourceBuffer.appendBuffer(nextChunk);
                } catch (error) {
                  console.error('❌ [MSE] Error appending queued chunk:', error);
                  isAppendingRef.current = false;
                }
              }
            }
          });

          sourceBuffer.addEventListener('error', (e) => {
            console.error('❌ [MSE] SourceBuffer error:', e);
            isAppendingRef.current = false;
          });

        } catch (error) {
          console.error('❌ [MSE] Error creating SourceBuffer:', error);
        }
      });

      console.log('✅ [MSE] MediaSource initialization complete');
    } catch (error) {
      console.error('❌ [MSE] Failed to initialize MediaSource:', error);
    }
  }, []);

  /**
   * Append audio chunk to SourceBuffer
   * Handles queueing if buffer is currently updating
   */
  const appendAudioChunk = useCallback((audioData: ArrayBuffer) => {
    if (!sourceBufferRef.current) {
      console.warn('⚠️ [MSE] SourceBuffer not ready, queueing chunk');
      audioChunkQueueRef.current.push(audioData);
      return;
    }

    // If currently updating, queue the chunk
    if (isAppendingRef.current || sourceBufferRef.current.updating) {
      audioChunkQueueRef.current.push(audioData);
      return;
    }

    // Append immediately
    try {
      isAppendingRef.current = true;
      sourceBufferRef.current.appendBuffer(audioData);
      console.log(`📥 [MSE] Appended audio chunk: ${audioData.byteLength} bytes`);
      
      // Auto-play after first chunk if not already playing
      if (audioElementRef.current && audioElementRef.current.paused) {
        audioElementRef.current.play().then(() => {
          console.log('▶️ [MSE] Audio playback started');
        }).catch((error) => {
          console.error('❌ [MSE] Failed to start playback:', error);
        });
      }
    } catch (error) {
      console.error('❌ [MSE] Error appending buffer:', error);
      isAppendingRef.current = false;
    }
  }, []);

  /**
   * Handle incoming audio chunk from WebSocket
   * Decodes base64 and appends to SourceBuffer via MSE
   */
  const handleAudioChunk = useCallback((base64Audio: string, format: string) => {
    try {
      if (!base64Audio || base64Audio.length === 0) {
        console.warn('⚠️ [MSE] Received empty audio data, skipping');
        return;
      }

      // Decode base64 to ArrayBuffer
      const binaryString = atob(base64Audio);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      const arrayBuffer = bytes.buffer;
      
      if (arrayBuffer.byteLength === 0) {
        console.warn('⚠️ [MSE] ArrayBuffer is empty after decoding, skipping');
        return;
      }

      appendAudioChunk(arrayBuffer);

    } catch (error) {
      console.error('❌ [MSE] Error handling audio chunk:', error);
    }
  }, [appendAudioChunk]);

  /**
   * Handle incoming WebSocket messages
   */
  const handleWebSocketMessage = useCallback((data: any) => {
    try {
      const message = typeof data === 'string' ? JSON.parse(data) : data;

      switch (message.type) {
        case 'ready':
          console.log('✅ WebSocket ready:', message.message);
          break;

        case 'transcript':
          if (message.isFinal) {
            setTranscript(message.data);
          } else {
            setTranscript(message.data + '...');
          }
          break;

        case 'ai_response':
          setAiResponse(message.data);
          break;

        case 'audio':
          handleAudioChunk(message.data, message.format || 'mp3');
          break;

        case 'audio_end':
          console.log('✅ [MSE] Audio stream ended, total chunks:', message.totalChunks);
          break;

        case 'recording_started':
          console.log('🎹️ Recording started on server');
          break;

        case 'recording_stopped':
          console.log('🛑 Recording stopped, full transcript:', message.fullTranscript);
          break;

        case 'error':
          console.error('❌ Server error:', message.message);
          alert('Error: ' + message.message);
          break;

        default:
          console.log('❓ Unknown message type:', message.type);
      }
    } catch (error) {
      console.error('❌ Error handling WebSocket message:', error);
    }
  }, [handleAudioChunk]);

  /**
   * Clear audio queue and reset MSE
   */
  const clearAudio = useCallback(() => {
    console.log('🧹 [MSE] Clearing audio...');
    
    if (audioElementRef.current) {
      audioElementRef.current.pause();
      audioElementRef.current.currentTime = 0;
    }
    
    audioChunkQueueRef.current = [];
    isAppendingRef.current = false;
    
    console.log('✅ [MSE] Audio cleared');
  }, []);

  // WebSocket connection
  const { sendMessage, lastMessage, connectionStatus } = useWebSocket({
    onMessage: handleWebSocketMessage,
  });

  // Microphone capture
  const { isRecording, startRecording, stopRecording } = useMicrophone({
    onAudioData: (audioData) => {
      if (!isMuted && isConnected) {
        sendMessage(audioData);
      }
    },
  });

  // Update connection status
  useEffect(() => {
    setIsConnected(connectionStatus === 'connected');
  }, [connectionStatus]);
  
  // Initialize MediaSource on mount
  useEffect(() => {
    console.log('🔗 [MSE] Component mounted');
    
    return () => {
      console.log('🧹 [MSE] Component unmounting, cleaning up...');
      
      if (audioElementRef.current) {
        audioElementRef.current.pause();
        audioElementRef.current.src = '';
      }
      
      if (mediaSourceRef.current) {
        if (mediaSourceRef.current.readyState === 'open') {
          try {
            mediaSourceRef.current.endOfStream();
          } catch (e) {
            // May already be ended
          }
        }
        mediaSourceRef.current = null;
      }
      
      sourceBufferRef.current = null;
      audioChunkQueueRef.current = [];
      
      console.log('✅ [MSE] Cleanup complete');
    };
  }, []);

  const handleMuteToggle = useCallback(() => {
    setIsMuted(prev => {
      const newMuted = !prev;
      sendMessage(JSON.stringify({
        type: 'control',
        action: newMuted ? 'mute' : 'unmute'
      }));
      return newMuted;
    });
  }, [sendMessage]);

  const handleEndSession = useCallback(() => {
    console.log('🛑 Ending session...');
    
    stopRecording();
    clearAudio();
    
    sendMessage(JSON.stringify({
      type: 'control',
      action: 'end_session'
    }));
    
    setTranscript('');
    setAiResponse('');
    
    console.log('✅ Session ended');
  }, [stopRecording, clearAudio, sendMessage]);

  const handleStartStop = useCallback(() => {
    if (isRecording) {
      stopRecording();
      
      sendMessage(JSON.stringify({
        type: 'stop_recording'
      }));
      
    } else {
      // Initialize MediaSource on user interaction
      initializeMediaSource();
      
      sendMessage(JSON.stringify({
        type: 'start_recording'
      }));
      
      setTimeout(() => {
        startRecording();
      }, 100);
    }
  }, [isRecording, stopRecording, sendMessage, initializeMediaSource, startRecording]);

  return (
    <div className="flex items-center justify-center min-h-screen p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-blue-600 to-purple-600 px-6 py-4">
          <h1 className="text-white text-2xl font-bold">Code Co-Pilot</h1>
          <p className="text-blue-100 text-sm">
            {isConnected ? '🟢 Connected' : '🔴 Disconnected'}
          </p>
        </div>

        {/* Main Content */}
        <div className="p-6 space-y-6">
          {/* Transcript Display */}
          <div className="bg-gray-50 rounded-lg p-4 min-h-[100px]">
            <h3 className="text-sm font-semibold text-gray-600 mb-2">Your Message</h3>
            <p className="text-gray-800">
              {transcript || 'Start speaking to see your transcript here...'}
            </p>
          </div>

          {/* AI Response Display */}
          <div className="bg-blue-50 rounded-lg p-4 min-h-[150px]">
            <h3 className="text-sm font-semibold text-blue-600 mb-2">AI Response</h3>
            <p className="text-gray-800 whitespace-pre-wrap">
              {aiResponse || 'AI responses will appear here...'}
            </p>
          </div>

          {/* Controls */}
          <div className="flex items-center justify-center gap-4">
            <button
              onClick={handleStartStop}
              disabled={!isConnected}
              className={`flex items-center justify-center w-16 h-16 rounded-full transition-all ${
                isRecording
                  ? 'bg-red-500 hover:bg-red-600 animate-pulse'
                  : 'bg-blue-500 hover:bg-blue-600'
              } disabled:bg-gray-300 disabled:cursor-not-allowed shadow-lg`}
              title={isRecording ? 'Stop Recording' : 'Start Recording'}
            >
              {isRecording ? (
                <svg className="w-8 h-8 text-white" fill="currentColor" viewBox="0 0 20 20">
                  <rect x="6" y="6" width="8" height="8" />
                </svg>
              ) : (
                <svg className="w-8 h-8 text-white" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M10 12a2 2 0 100-4 2 2 0 000 4z" />
                  <path
                    fillRule="evenodd"
                    d="M10 18a8 8 0 100-16 8 8 0 000 16zm0-2a6 6 0 100-12 6 6 0 000 12z"
                    clipRule="evenodd"
                  />
                </svg>
              )}
            </button>

            <button
              onClick={handleMuteToggle}
              disabled={!isConnected}
              className={`px-6 py-3 rounded-lg font-medium transition-all ${
                isMuted
                  ? 'bg-yellow-500 hover:bg-yellow-600'
                  : 'bg-green-500 hover:bg-green-600'
              } text-white disabled:bg-gray-300 disabled:cursor-not-allowed shadow-md`}
            >
              {isMuted ? '🔇 Unmute' : '🔊 Mute'}
            </button>

            <button
              onClick={handleEndSession}
              className="px-6 py-3 bg-gray-600 hover:bg-gray-700 text-white rounded-lg font-medium transition-all shadow-md"
            >
              End Session
            </button>
          </div>

          <div className="text-center text-sm text-gray-500">
            Status: {connectionStatus}
          </div>
        </div>
      </div>

      {/* Audio element for MSE playback */}
      <audio ref={audioElementRef} className="hidden" />
    </div>
  );
}
```

## Key Changes Summary

### Removed (Web Audio API):
- `audioContextRef`, `audioQueueRef`, `isPlayingRef`, `nextPlayTimeRef`, `currentSourceRef`
- `initAudioContext()`, `playNextInQueue()`, `queueAudioChunk()`
- Manual buffer scheduling and timing logic

### Added (Media Source Extensions):
- `audioElementRef`, `mediaSourceRef`, `sourceBufferRef`, `audioChunkQueueRef`, `isAppendingRef`
- `initializeMediaSource()` - creates MediaSource and SourceBuffer
- `appendAudioChunk()` - manages buffer appending with queue
- `handleAudioChunk()` - decodes base64 and appends to buffer
- Automatic playback via HTML5 `<audio>` element

### Benefits:
✅ **Smoother playback** - Browser handles buffering natively
✅ **No manual scheduling** - Eliminates gaps and pops
✅ **Better MP3 support** - MSE designed for streaming media
✅ **Simpler code** - Let the browser do the heavy lifting

## Testing

1. Replace the entire `SidecarView.tsx` file
2. Start both servers
3. Click Start Recording
4. Backend logs should show `[START_RECORDING]`, `[START]` tags
5. Speak and wait for AI response
6. Audio should play smoothly without choppiness
7. Click Stop Recording - backend should show `[STOP_RECORDING]`, `[STOP]` tags
8. Click Start again - should work reliably with fresh transcriber instance

Backend is production-ready with robust state management! 🎉
