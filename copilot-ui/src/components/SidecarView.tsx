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
  
  // Refs
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioQueueRef = useRef<AudioBuffer[]>([]);
  const isPlayingRef = useRef(false);
  const nextPlayTimeRef = useRef(0);

  /**
   * Initialize Web Audio API context
   * Must be called after user interaction
   */
  const initAudioContext = useCallback(() => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      console.log('Audio context initialized');
    }
  }, []);

  /**
   * Play next audio buffer in queue
   */
  const playNextInQueue = useCallback(() => {
    if (!audioContextRef.current || audioQueueRef.current.length === 0) {
      isPlayingRef.current = false;
      return;
    }

    isPlayingRef.current = true;
    const audioBuffer = audioQueueRef.current.shift()!;

    // Create buffer source
    const source = audioContextRef.current.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(audioContextRef.current.destination);

    // Calculate when to start playing
    const currentTime = audioContextRef.current.currentTime;
    const startTime = Math.max(currentTime, nextPlayTimeRef.current);
    
    // Schedule playback
    source.start(startTime);
    
    // Update next play time
    nextPlayTimeRef.current = startTime + audioBuffer.duration;

    // When this buffer ends, play next
    source.onended = () => {
      playNextInQueue();
    };
  }, []); // No dependencies - uses only refs and recursion

  /**
   * Queue an audio chunk for playback
   */
  const queueAudioChunk = useCallback(async (base64Audio: string, format: string) => {
    try {
      if (!audioContextRef.current) {
        initAudioContext();
      }

      // Decode base64 to ArrayBuffer
      const binaryString = atob(base64Audio);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      const arrayBuffer = bytes.buffer;

      // Decode audio data
      const audioBuffer = await audioContextRef.current!.decodeAudioData(arrayBuffer);
      
      // Add to queue
      audioQueueRef.current.push(audioBuffer);

      // Start playing if not already playing
      if (!isPlayingRef.current) {
        playNextInQueue();
      }

    } catch (error) {
      console.error('Error queuing audio chunk:', error);
    }
  }, [initAudioContext, playNextInQueue]);

  /**
   * Handle incoming WebSocket messages
   */
  const handleWebSocketMessage = useCallback((data: any) => {
    try {
      const message = typeof data === 'string' ? JSON.parse(data) : data;

      switch (message.type) {
        case 'ready':
          console.log('WebSocket ready:', message.message);
          break;

        case 'transcript':
          if (message.isFinal) {
            setTranscript(message.data);
          } else {
            // Show interim results in a lighter color or different style
            setTranscript(message.data + '...');
          }
          break;

        case 'ai_response':
          setAiResponse(message.data);
          break;

        case 'audio':
          // Queue and play audio chunk
          queueAudioChunk(message.data, message.format || 'mp3');
          break;

        case 'audio_end':
          console.log('Audio stream ended, total chunks:', message.totalChunks);
          break;

        case 'recording_started':
          console.log('Recording started on server');
          break;

        case 'recording_stopped':
          console.log('Recording stopped, full transcript:', message.fullTranscript);
          break;

        case 'error':
          console.error('Server error:', message.message);
          alert('Error: ' + message.message);
          break;

        default:
          console.log('Unknown message type:', message.type);
      }
    } catch (error) {
      console.error('Error handling WebSocket message:', error);
    }
  }, [queueAudioChunk]); // Note: setState functions (setTranscript, setAiResponse) are stable and omitted

  /**
   * Clear audio queue (e.g., when stopping)
   */
  const clearAudioQueue = useCallback(() => {
    audioQueueRef.current = [];
    isPlayingRef.current = false;
    nextPlayTimeRef.current = 0;
  }, []);

  // Hooks must be called after all callback definitions
  // WebSocket connection
  const { sendMessage, lastMessage, connectionStatus } = useWebSocket({
    onMessage: handleWebSocketMessage,
  });

  // Microphone capture
  const { isRecording, startRecording, stopRecording } = useMicrophone({
    onAudioData: (audioData) => {
      // Send audio data to backend via WebSocket
      if (!isMuted && isConnected) {
        sendMessage(audioData);
      }
    },
  });

  // Update connection status
  useEffect(() => {
    setIsConnected(connectionStatus === 'connected');
  }, [connectionStatus]);

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
    stopRecording();
    clearAudioQueue();
    
    sendMessage(JSON.stringify({
      type: 'control',
      action: 'end_session'
    }));
    
    // Reset state
    setTranscript('');
    setAiResponse('');
  }, [stopRecording, clearAudioQueue, sendMessage]);

  const handleStartStop = useCallback(() => {
    if (isRecording) {
      stopRecording();
      
      // Notify server to stop transcription
      sendMessage(JSON.stringify({
        type: 'stop_recording'
      }));
      
    } else {
      // Initialize audio context on user interaction (browser requirement)
      initAudioContext();
      
      // IMPORTANT: Send start_recording message BEFORE starting microphone
      // This ensures Deepgram is ready to receive audio chunks
      sendMessage(JSON.stringify({
        type: 'start_recording'
      }));
      
      // Small delay to let server initialize transcriber
      setTimeout(() => {
        startRecording();
      }, 100);
    }
  }, [isRecording, stopRecording, sendMessage, initAudioContext, startRecording]);

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
            {/* Record/Stop Button */}
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

            {/* Mute Button */}
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

            {/* End Session Button */}
            <button
              onClick={handleEndSession}
              className="px-6 py-3 bg-gray-600 hover:bg-gray-700 text-white rounded-lg font-medium transition-all shadow-md"
            >
              End Session
            </button>
          </div>

          {/* Connection Status */}
          <div className="text-center text-sm text-gray-500">
            Status: {connectionStatus}
          </div>
        </div>
      </div>

      {/* Hidden audio element for playback */}
      <audio ref={audioRef} className="hidden" />
    </div>
  );
}
