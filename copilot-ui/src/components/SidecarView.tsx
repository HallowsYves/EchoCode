'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useWebSocket } from '@/hooks/useWebSocket';
import { useMicrophone } from '@/hooks/useMicrophone';

/**
 * Detect audio format based on magic bytes (file signature)
 * This helps identify format mismatches between backend and frontend
 */
function detectAudioFormat(bytes: Uint8Array): string {
  if (bytes.length < 4) return 'unknown';
  
  // MP3: Starts with 0xFF 0xFB, 0xFF 0xF3, 0xFF 0xF2, or ID3 tag (0x49 0x44 0x33)
  if (bytes[0] === 0xFF && (bytes[1] === 0xFB || bytes[1] === 0xF3 || bytes[1] === 0xF2)) {
    return 'mp3';
  }
  if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
    return 'mp3 (ID3 tag)';
  }
  
  // WAV: Starts with "RIFF" (0x52 0x49 0x46 0x46)
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) {
    return 'wav';
  }
  
  // OGG/Opus: Starts with "OggS" (0x4F 0x67 0x67 0x53)
  if (bytes[0] === 0x4F && bytes[1] === 0x67 && bytes[2] === 0x67 && bytes[3] === 0x53) {
    return 'ogg/opus';
  }
  
  // WebM: Starts with 0x1A 0x45 0xDF 0xA3
  if (bytes[0] === 0x1A && bytes[1] === 0x45 && bytes[2] === 0xDF && bytes[3] === 0xA3) {
    return 'webm';
  }
  
  // MP4/M4A: Starts with ftyp box (usually at byte 4-7: "ftyp")
  if (bytes.length >= 8) {
    if (bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) {
      return 'mp4/m4a';
    }
  }
  
  // FLAC: Starts with "fLaC" (0x66 0x4C 0x61 0x43)
  if (bytes[0] === 0x66 && bytes[1] === 0x4C && bytes[2] === 0x61 && bytes[3] === 0x43) {
    return 'flac';
  }
  
  return 'unknown';
}

export default function SidecarView() {
  console.log('SidecarView re-rendered');
  
  // State
  const [transcript, setTranscript] = useState<string>('');
  const [aiResponse, setAiResponse] = useState<string>('');
  const [isConnected, setIsConnected] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [textInput, setTextInput] = useState<string>('');
  const [processingState, setProcessingState] = useState<'idle' | 'listening' | 'processing' | 'speaking'>('idle');
  
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
    
    // Set audio element properties for playback
    if (audioElementRef.current) {
      audioElementRef.current.muted = false;
      audioElementRef.current.volume = 1.0;
      console.log('🔊 [MSE] Audio element configured: muted=false, volume=1.0');
    }
    
    try {
      const mediaSource = new MediaSource();
      mediaSourceRef.current = mediaSource;

      const objectURL = URL.createObjectURL(mediaSource);
      audioElementRef.current.src = objectURL;
      console.log('🔗 [MSE] Object URL created and set as audio src:', objectURL);

      // MediaSource event: sourceopen
      mediaSource.addEventListener('sourceopen', () => {
        console.log('✅ [MSE] MediaSource opened');
        console.log('   MediaSource.readyState:', mediaSource.readyState);
        
        try {
          // CRITICAL: Verify this MIME type matches the Fish Audio API format
          const mimeType = 'audio/mpeg'; // Backend sends MP3 (confirmed in textToSpeech.ts:137)
          
          console.warn(`
⚠️⚠️⚠️ [MSE] MIME TYPE VERIFICATION REQUIRED ⚠️⚠️⚠️
Current MIME type: '${mimeType}'
Please verify that Fish Audio API is sending this exact format.
Check textToSpeech.ts line 137 - format parameter in the request.
If Fish Audio sends a different format (e.g., 'audio/opus', 'audio/wav'),
this MUST be changed or audio will NOT play!
          `);
          
          // Check browser support BEFORE creating SourceBuffer
          const isSupported = MediaSource.isTypeSupported(mimeType);
          console.log(`🔍 [MSE] MediaSource.isTypeSupported('${mimeType}'):`, isSupported);
          
          if (!isSupported) {
            console.error(`❌ [MSE] FATAL: MIME type '${mimeType}' is NOT supported by this browser!`);
            console.error('   Available codecs check:');
            console.error('   - audio/mpeg:', MediaSource.isTypeSupported('audio/mpeg'));
            console.error('   - audio/mp4:', MediaSource.isTypeSupported('audio/mp4'));
            console.error('   - audio/webm:', MediaSource.isTypeSupported('audio/webm'));
            return;
          }
          
          // Create SourceBuffer
          const sourceBuffer = mediaSource.addSourceBuffer(mimeType);
          sourceBufferRef.current = sourceBuffer;
          console.log(`✅ [MSE] SourceBuffer created successfully with MIME type: ${mimeType}`);
          console.log('   SourceBuffer.mode:', sourceBuffer.mode);
          console.log('   SourceBuffer.updating:', sourceBuffer.updating);

          // SourceBuffer event: updateend
          sourceBuffer.addEventListener('updateend', () => {
            console.log('🔄 [MSE] SourceBuffer updateend event fired');
            console.log('   Queue length:', audioChunkQueueRef.current.length);
            console.log('   SourceBuffer.updating:', sourceBuffer.updating);
            console.log('   SourceBuffer.buffered.length:', sourceBuffer.buffered.length);
            
            if (sourceBuffer.buffered.length > 0) {
              console.log('   Buffered time ranges:');
              for (let i = 0; i < sourceBuffer.buffered.length; i++) {
                console.log(`     [${i}] ${sourceBuffer.buffered.start(i).toFixed(2)}s - ${sourceBuffer.buffered.end(i).toFixed(2)}s`);
              }
            }
            
            isAppendingRef.current = false;
            
            // Process next chunk from queue
            if (audioChunkQueueRef.current.length > 0 && !isAppendingRef.current) {
              const nextChunk = audioChunkQueueRef.current.shift();
              console.log(`📦 [MSE] Processing queued chunk (${audioChunkQueueRef.current.length} remaining)`);
              
              if (nextChunk) {
                try {
                  console.log(`   Chunk size: ${nextChunk.byteLength} bytes`);
                  console.log('   SourceBuffer.updating before append:', sourceBuffer.updating);
                  
                  isAppendingRef.current = true;
                  sourceBuffer.appendBuffer(nextChunk);
                  console.log(`➡️ [MSE] Appending queued buffer: ${nextChunk.byteLength} bytes`);
                } catch (error) {
                  console.error('❌ [MSE] Error appending queued chunk:', error);
                  console.error('   Error name:', (error as Error).name);
                  console.error('   Error message:', (error as Error).message);
                  isAppendingRef.current = false;
                }
              }
            }
          });

          // SourceBuffer event: error
          sourceBuffer.addEventListener('error', (e) => {
            console.error('❌ [MSE] SourceBuffer error event:', e);
            console.error('   Event type:', e.type);
            console.error('   SourceBuffer state:', {
              updating: sourceBuffer.updating,
              mode: sourceBuffer.mode,
              buffered: sourceBuffer.buffered.length
            });
            isAppendingRef.current = false;
          });

          // SourceBuffer event: abort
          sourceBuffer.addEventListener('abort', (e) => {
            console.warn('⚠️ [MSE] SourceBuffer abort event:', e);
            isAppendingRef.current = false;
          });

        } catch (error) {
          console.error('❌ [MSE] Error creating SourceBuffer:', error);
          console.error('   Error name:', (error as Error).name);
          console.error('   Error message:', (error as Error).message);
          if (error instanceof DOMException) {
            console.error('   DOM Exception code:', error.code);
          }
        }
      });

      // MediaSource event: sourceended
      mediaSource.addEventListener('sourceended', () => {
        console.log('🏁 [MSE] MediaSource sourceended event');
      });

      // MediaSource event: sourceclosed
      mediaSource.addEventListener('sourceclosed', () => {
        console.log('🔒 [MSE] MediaSource sourceclosed event');
      });

      // MediaSource event: error
      mediaSource.addEventListener('error', (e) => {
        console.error('❌ [MSE] MediaSource error event:', e);
        console.error('   MediaSource.readyState:', mediaSource.readyState);
      });

      console.log('✅ [MSE] MediaSource initialization complete');
    } catch (error) {
      console.error('❌ [MSE] Failed to initialize MediaSource:', error);
      console.error('   Error name:', (error as Error).name);
      console.error('   Error message:', (error as Error).message);
    }
  }, []);

  /**
   * Append audio chunk to SourceBuffer
   * Handles queueing if buffer is currently updating
   */
  const appendAudioChunk = useCallback((audioData: ArrayBuffer) => {
    if (!sourceBufferRef.current) {
      console.warn('⚠️ [MSE] SourceBuffer not ready, queueing chunk');
      console.warn('   Chunk size:', audioData.byteLength, 'bytes');
      console.warn('   Current queue length:', audioChunkQueueRef.current.length);
      audioChunkQueueRef.current.push(audioData);
      return;
    }

    // If currently updating, queue the chunk
    if (isAppendingRef.current || sourceBufferRef.current.updating) {
      console.log('⏸️ [MSE] SourceBuffer busy, queueing chunk');
      console.log('   isAppendingRef:', isAppendingRef.current);
      console.log('   sourceBuffer.updating:', sourceBufferRef.current.updating);
      console.log('   Chunk size:', audioData.byteLength, 'bytes');
      audioChunkQueueRef.current.push(audioData);
      console.log('   New queue length:', audioChunkQueueRef.current.length);
      return;
    }

    // Append immediately
    try {
      console.log(`➡️ [MSE] Attempting to append buffer: ${audioData.byteLength} bytes`);
      console.log('   SourceBuffer.updating before append:', sourceBufferRef.current.updating);
      console.log('   SourceBuffer.mode:', sourceBufferRef.current.mode);
      
      isAppendingRef.current = true;
      sourceBufferRef.current.appendBuffer(audioData);
      console.log(`✅ [MSE] Successfully appended audio chunk: ${audioData.byteLength} bytes`);
      
      // Check audio element state
      if (audioElementRef.current) {
        console.log('🎵 [Audio Element] State after append:');
        console.log('   paused:', audioElementRef.current.paused);
        console.log('   currentTime:', audioElementRef.current.currentTime);
        console.log('   duration:', audioElementRef.current.duration);
        console.log('   readyState:', audioElementRef.current.readyState);
        console.log('   muted:', audioElementRef.current.muted);
        console.log('   volume:', audioElementRef.current.volume);
        
        // Check for errors
        if (audioElementRef.current.error) {
          console.error('❌ [Audio Element] Error detected:', {
            code: audioElementRef.current.error.code,
            message: audioElementRef.current.error.message
          });
        }
      }
      
      // Auto-play after first chunk if not already playing
      if (audioElementRef.current && audioElementRef.current.paused) {
        console.log('▶️ [MSE] Attempting to start audio playback...');
        audioElementRef.current.play().then(() => {
          console.log('✅ [MSE] Audio playback started successfully');
          console.log('   currentTime:', audioElementRef.current?.currentTime);
          console.log('   paused:', audioElementRef.current?.paused);
        }).catch((error) => {
          console.error('❌ [MSE] Failed to start playback:', error);
          console.error('   Error name:', error.name);
          console.error('   Error message:', error.message);
          console.error('   This might be due to browser autoplay policy');
          console.error('   User interaction (click/tap) may be required first');
        });
      }
    } catch (error) {
      console.error('❌ [MSE] Error appending buffer:', error);
      console.error('   Error name:', (error as Error).name);
      console.error('   Error message:', (error as Error).message);
      if (error instanceof DOMException) {
        console.error('   DOM Exception code:', error.code);
      }
      console.error('   SourceBuffer state:', {
        updating: sourceBufferRef.current?.updating,
        mode: sourceBufferRef.current?.mode
      });
      isAppendingRef.current = false;
    }
  }, []);

  /**
   * Handle incoming audio chunk from WebSocket
   * Decodes base64 and appends to SourceBuffer via MSE
   */
  const handleAudioChunk = useCallback((base64Audio: string, format: string) => {
    try {
      console.log(`⬇️ [WS] Received audio chunk - Format: ${format}, Base64 length: ${base64Audio?.length || 0}`);
      
      if (!base64Audio || base64Audio.length === 0) {
        console.warn('⚠️ [MSE] Received empty audio data, skipping');
        return;
      }

      // Decode base64 to ArrayBuffer
      console.log('🔄 [MSE] Decoding base64 audio data...');
      const binaryString = atob(base64Audio);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      const arrayBuffer = bytes.buffer;
      
      console.log(`⬇️ [WS] Decoded audio chunk: ${arrayBuffer.byteLength} bytes`);
      
      if (arrayBuffer.byteLength === 0) {
        console.warn('⚠️ [MSE] ArrayBuffer is empty after decoding, skipping');
        return;
      }
      
      // Log first 16 bytes for comprehensive format debugging
      const firstBytes = new Uint8Array(arrayBuffer.slice(0, Math.min(16, arrayBuffer.byteLength)));
      const hexString = Array.from(firstBytes).map(b => b.toString(16).padStart(2, '0')).join(' ');
      console.log('🔍 [MSE] First bytes (hex):', hexString);
      console.log('🔍 [MSE] First bytes (decimal):', Array.from(firstBytes).join(', '));
      
      // Format detection based on magic bytes
      const formatDetection = detectAudioFormat(firstBytes);
      console.log('🔍 [MSE] Detected format:', formatDetection);
      
      if (formatDetection !== 'mp3' && formatDetection !== 'unknown') {
        console.error(`❌ [MSE] FORMAT MISMATCH! Expected MP3 but got ${formatDetection}`);
        console.error('   This WILL cause playback to fail!');
        console.error('   Update the MIME type in initializeMediaSource() to match this format');
      }

      appendAudioChunk(arrayBuffer);

    } catch (error) {
      console.error('❌ [MSE] Error handling audio chunk:', error);
      console.error('   Error name:', (error as Error).name);
      console.error('   Error message:', (error as Error).message);
      console.error('   Base64 length:', base64Audio?.length);
      console.error('   Format:', format);
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
            // Final transcript received, AI is now processing
            setProcessingState('processing');
          } else {
            setTranscript(message.data + '...');
          }
          break;

        case 'ai_response':
          setAiResponse(message.data);
          break;

        case 'audio':
          // First audio chunk received, AI is now speaking
          if (processingState !== 'speaking') {
            setProcessingState('speaking');
          }
          handleAudioChunk(message.data, message.format || 'mp3');
          break;

        case 'audio_end':
          console.log('✅ [MSE] Audio stream ended, total chunks:', message.totalChunks);
          // Audio playback ended, return to idle
          setProcessingState('idle');
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
          // Reset to idle on error
          setProcessingState('idle');
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
  
  // Initialize MediaSource on mount - CRITICAL for preventing empty src errors
  useEffect(() => {
    console.log('🔗 [MSE] Component mounted, initializing MediaSource...');
    
    // Initialize MediaSource immediately on mount to prevent empty src errors
    // This ensures the audio element has a valid src before any audio chunks arrive
    if (audioElementRef.current && !mediaSourceRef.current) {
      initializeMediaSource();
    }
    
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
  }, [initializeMediaSource]);

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
    setProcessingState('idle');
    
    console.log('✅ Session ended');
  }, [stopRecording, clearAudio, sendMessage]);

  const handleClear = useCallback(() => {
    console.log('🧹 Clearing transcript and AI response...');
    setTranscript('');
    setAiResponse('');
    setProcessingState('idle');
  }, []);

  const handleSendTextMessage = useCallback(() => {
    const trimmedText = textInput.trim();
    
    if (trimmedText && isConnected) {
      console.log('💬 Sending text message:', trimmedText);
      
      // Ensure MediaSource is initialized before sending (audio response expected)
      if (!mediaSourceRef.current && audioElementRef.current) {
        console.log('⚠️ [MSE] MediaSource not initialized, initializing now...');
        initializeMediaSource();
      }
      
      // Send text input to server
      sendMessage(JSON.stringify({
        type: 'text_input',
        message: trimmedText
      }));
      
      // Update local transcript for immediate feedback
      setTranscript(`You (Typed): ${trimmedText}`);
      
      // Set state to processing as AI is thinking
      setProcessingState('processing');
      
      // Clear input field
      setTextInput('');
    }
  }, [textInput, isConnected, sendMessage, initializeMediaSource]);

  const handleTextInputKeyPress = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleSendTextMessage();
    }
  }, [handleSendTextMessage]);

  const handleStartStop = useCallback(() => {
    if (isRecording) {
      stopRecording();
      
      sendMessage(JSON.stringify({
        type: 'stop_recording'
      }));
      
      // Recording stopped, no longer listening
      setProcessingState('idle');
      
    } else {
      // Ensure MediaSource is initialized (redundant check, but safe)
      if (!mediaSourceRef.current && audioElementRef.current) {
        console.log('⚠️ [MSE] MediaSource not initialized, initializing now...');
        initializeMediaSource();
      }
      
      sendMessage(JSON.stringify({
        type: 'start_recording'
      }));
      
      // Set state to listening when recording starts
      setProcessingState('listening');
      
      setTimeout(() => {
        startRecording();
      }, 100);
    }
  }, [isRecording, stopRecording, sendMessage, initializeMediaSource, startRecording]);

  return (
    <div className="flex items-center justify-center min-h-screen p-4 bg-gray-50 dark:bg-gray-900">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg border border-gray-200 dark:border-gray-700 w-full max-w-2xl overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-blue-600 to-purple-600 px-6 py-4">
          <h1 className="text-white text-2xl font-bold">Code Co-Pilot</h1>
          <p className="text-blue-100 text-sm">
            {isConnected ? 'Connected' : 'Disconnected'}
          </p>
        </div>

        {/* Main Content */}
        <div className="p-6 space-y-4">
          {/* Status Indicator */}
          {processingState !== 'idle' && (
            <div className={`text-center py-2 px-4 rounded-lg font-medium ${
              processingState === 'listening' ? 'bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200' :
              processingState === 'processing' ? 'bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200 animate-pulse' :
              'bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200'
            }`}>
              {processingState === 'listening' && ' Listening...'}
              {processingState === 'processing' && ' AI is thinking...'}
              {processingState === 'speaking' && ' AI Speaking...'}
            </div>
          )}

          {/* Transcript Display */}
          <div className={`rounded-lg p-4 min-h-[100px] transition-colors bg-gray-100 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 ${
            processingState === 'listening' ? 'ring-2 ring-green-400 dark:ring-green-500' : ''
          }`}>
            <h3 className="font-semibold text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2">Your Message</h3>
            <p className="text-gray-800 dark:text-gray-200">
              {transcript || 'Start speaking to see your transcript here...'}
            </p>
          </div>

          {/* AI Response Display */}
          <div className={`rounded-lg p-4 min-h-[150px] transition-colors bg-gray-100 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 ${
            processingState === 'processing' ? 'ring-2 ring-yellow-400 dark:ring-yellow-500' :
            processingState === 'speaking' ? 'ring-2 ring-blue-400 dark:ring-blue-500' :
            ''
          }`}>
            <h3 className="font-semibold text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2">AI Response</h3>
            <p className="text-gray-800 dark:text-gray-200 whitespace-pre-wrap">
              {aiResponse || 'AI responses will appear here...'}
            </p>
          </div>

          {/* Text Input Section */}
          <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
            <h3 className="font-semibold text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2">Type a Message</h3>
            <div className="flex gap-2">
              <input
                type="text"
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                onKeyPress={handleTextInputKeyPress}
                placeholder="Type your message here..."
                disabled={!isConnected}
                className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-white disabled:bg-gray-100 dark:disabled:bg-gray-800 disabled:cursor-not-allowed"
              />
              <button
                onClick={handleSendTextMessage}
                disabled={!isConnected || !textInput.trim()}
                className="px-4 py-2 bg-blue-500 hover:opacity-80 text-white rounded-lg font-medium transition-opacity duration-150 disabled:bg-gray-300 dark:disabled:bg-gray-700 disabled:cursor-not-allowed border border-transparent"
              >
                Send
              </button>
            </div>
          </div>

          {/* Controls */}
          <div className="flex items-center justify-center gap-4 flex-wrap">
            <button
              onClick={handleStartStop}
              disabled={!isConnected}
              className={`flex items-center justify-center w-16 h-16 rounded-full transition-all border ${
                isRecording
                  ? 'bg-red-500 hover:opacity-80 animate-pulse border-transparent'
                  : 'bg-blue-500 hover:opacity-80 border dark:border-gray-600'
              } disabled:bg-gray-300 dark:disabled:bg-gray-700 disabled:cursor-not-allowed shadow-lg`}
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
              className={`px-4 py-2 rounded-lg font-medium transition-opacity duration-150 hover:opacity-80 border ${
                isMuted
                  ? 'bg-gray-500 hover:bg-gray-600 border-gray-600'
                  : 'bg-indigo-500 hover:bg-indigo-600 border-transparent'
              } text-white disabled:bg-gray-300 dark:disabled:bg-gray-700 disabled:cursor-not-allowed`}
            >
              {isMuted ? '🔇 Mute' : '🔊 Unmute'}
            </button>

            <button
              onClick={handleClear}
              className="px-4 py-2 bg-yellow-500 hover:opacity-80 text-white rounded-lg font-medium transition-opacity duration-150 border border-transparent"
              title="Clear transcript and AI response"
            >
              🧹 Clear
            </button>

            <button
              onClick={handleEndSession}
              className="px-4 py-2 bg-gray-600 hover:opacity-80 text-white rounded-lg font-medium transition-opacity duration-150 border border-gray-600"
            >
              End Session
            </button>
          </div>

          <div className="text-center text-sm text-gray-500 dark:text-gray-400">
            Status: {connectionStatus}
          </div>
        </div>
      </div>

      {/* Audio element for MSE playback */}
      <audio 
        ref={audioElementRef} 
        className="hidden"
        onLoadedMetadata={() => console.log('🎵 [Audio Element] loadedmetadata event')}
        onLoadedData={() => console.log('🎵 [Audio Element] loadeddata event')}
        onCanPlay={() => console.log('🎵 [Audio Element] canplay event')}
        onCanPlayThrough={() => console.log('🎵 [Audio Element] canplaythrough event')}
        onPlaying={() => console.log('▶️ [Audio Element] playing event')}
        onPause={() => console.log('⏸️ [Audio Element] pause event')}
        onEnded={() => console.log('🏁 [Audio Element] ended event')}
        onError={(e) => {
          console.error('❌ [Audio Element] error event:', e);
          if (audioElementRef.current?.error) {
            console.error('   Error code:', audioElementRef.current.error.code);
            console.error('   Error message:', audioElementRef.current.error.message);
          }
        }}
        onTimeUpdate={() => {
          // Log occasionally, not on every update
          if (audioElementRef.current && Math.floor(audioElementRef.current.currentTime) % 2 === 0) {
            console.log(`⏱️ [Audio Element] timeupdate: ${audioElementRef.current.currentTime.toFixed(2)}s / ${audioElementRef.current.duration.toFixed(2)}s`);
          }
        }}
        onWaiting={() => console.log('⏳ [Audio Element] waiting event (buffering)')}
        onStalled={() => console.log('🚧 [Audio Element] stalled event')}
      />
    </div>
  );
}
