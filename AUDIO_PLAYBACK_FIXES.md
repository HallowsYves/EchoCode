# Audio Playback Fixes - Choppy Audio and Pop Noises

## Problem Summary
The Web Audio API implementation in `SidecarView.tsx` was experiencing:
- **Choppy Audio**: Speech cutting out with gaps and stuttering
- **Pop/Click Noises**: Unexpected clicking sounds during playback

## Root Causes Identified

### 1. Missing Error Handling
- No try-catch around `decodeAudioData()` 
- Invalid audio buffers were being queued, causing playback glitches
- No validation of decoded audio buffer properties

### 2. AudioContext State Management Issues
- No checking if AudioContext was in 'running' state before playback
- No handling of 'suspended' or 'interrupted' states
- Missing `statechange` event listener

### 3. Inadequate Data Validation
- No validation of base64 input data before decoding
- No checking for empty or corrupt audio chunks
- No size validation of ArrayBuffers

### 4. Scheduling Precision Problems
- Insufficient logging to debug timing issues
- No detection of scheduling gaps between chunks
- No warnings for very short audio buffers

### 5. Resource Cleanup Issues
- AudioContext not being closed on component unmount
- No cleanup in `handleEndSession()`
- Currently playing audio sources not being stopped when clearing queue

## Solutions Implemented

### 1. Robust Error Handling (`queueAudioChunk`)
```typescript
// Validates base64 data before decoding
if (!base64Audio || base64Audio.length === 0) {
  console.warn('⚠️ Received empty audio data, skipping');
  return;
}

// Explicit try-catch around decodeAudioData
try {
  audioBuffer = await audioContextRef.current.decodeAudioData(arrayBuffer);
  console.log(`✅ Decoded successfully: duration=${audioBuffer.duration.toFixed(3)}s`);
} catch (decodeError) {
  console.error('❌ Failed to decode audio chunk:', decodeError);
  return; // Do NOT queue invalid buffer
}
```

**Impact**: Prevents corrupt or invalid audio chunks from being queued, eliminating pops and clicks caused by bad data.

### 2. AudioContext State Management (`playNextInQueue`)
```typescript
// Check if audio context is in a playable state
if (audioContextRef.current.state !== 'running') {
  console.warn(`⚠️ Cannot play: AudioContext state is '${audioContextRef.current.state}'`);
  
  // Try to resume if suspended
  if (audioContextRef.current.state === 'suspended') {
    audioContextRef.current.resume().then(() => {
      playNextInQueue(); // Retry after resuming
    });
  }
  return;
}
```

**Impact**: Ensures audio only plays when the context is ready, preventing silent failures and playback interruptions.

### 3. State Change Monitoring (`initAudioContext`)
```typescript
// Add state change listener to track context state
audioContextRef.current.addEventListener('statechange', () => {
  const state = audioContextRef.current?.state;
  console.log('🔄 AudioContext state changed to:', state);
  
  if (state === 'suspended') {
    console.warn('⚠️ AudioContext suspended - playback may be interrupted');
  }
});
```

**Impact**: Provides visibility into AudioContext state changes, making debugging easier and allowing proactive handling of suspensions.

### 4. Enhanced Scheduling Precision (`playNextInQueue`)
```typescript
// Calculate precise start time to avoid gaps and overlaps
const currentTime = audioContextRef.current.currentTime;
const startTime = Math.max(currentTime, nextPlayTimeRef.current);

// Detect scheduling gaps that might cause choppy playback
const schedulingGap = startTime - currentTime;
if (schedulingGap > 0.05) {
  console.warn(`⚠️ Scheduling gap detected: ${schedulingGap.toFixed(3)}s`);
}

// Schedule playback - MUST happen before updating nextPlayTimeRef
source.start(startTime);

// Update next play time IMMEDIATELY after scheduling
nextPlayTimeRef.current = startTime + audioBuffer.duration;
```

**Impact**: Ensures seamless playback by precisely scheduling chunks and detecting potential gaps that cause choppiness.

### 5. Proper Resource Cleanup
```typescript
// Cleanup audio context on unmount
useEffect(() => {
  return () => {
    // Stop currently playing audio
    if (currentSourceRef.current) {
      currentSourceRef.current.stop();
      currentSourceRef.current = null;
    }
    
    // Clear queue
    audioQueueRef.current = [];
    
    // Close audio context
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
  };
}, []);
```

**Impact**: Prevents resource leaks and ensures clean teardown, eliminating issues when components remount.

### 6. Comprehensive Logging
All critical operations now have detailed logging:
- 🎵 Audio context initialization
- 📥 Received audio chunks (format, size)
- ✅ Successful decoding (duration, channels, sample rate)
- ▶️ Playback scheduling (times, gaps)
- ⚠️ Warnings for edge cases (small chunks, scheduling gaps)
- ❌ Errors with diagnostic information

**Impact**: Makes debugging much easier and provides visibility into the audio pipeline.

## Audio Format Compatibility

### Confirmed Format
**Backend sends MP3 format** (confirmed in `textToSpeech.ts` line 137 and `audioHandler.ts` line 248):
```typescript
format: 'mp3', // Supported formats: mp3, wav, pcm, opus
```

### Compatibility Notes
- **MP3**: ✅ Natively supported by `decodeAudioData()`
- **WAV**: ✅ Natively supported by `decodeAudioData()`
- **Opus**: ✅ Natively supported by `decodeAudioData()`
- **Raw PCM** (e.g., `pcm_s16le`): ❌ Would require WAV header prepending

The current implementation correctly handles MP3 without any special processing.

## Testing Checklist

To verify the fixes work:

1. **Start a recording session** - Check console for "🎵 Audio context initialized"
2. **Speak and wait for AI response** - Monitor console for:
   - "📥 Received audio chunk" messages
   - "✅ Decoded successfully" messages
   - "▶️ Playing audio chunk" messages
3. **Listen for smooth playback** - No gaps, stuttering, or pops
4. **Check for errors** - Look for "❌" or "⚠️" in console
5. **End session** - Verify "🔒 Closing AudioContext" appears
6. **Multiple sessions** - Start/stop several times to test cleanup

## Expected Console Output (Successful Playback)

```
🎵 Audio context initialized
   State: running
   Sample rate: 48000
📥 Received audio chunk: format=mp3, base64Length=8192
   Decoded to ArrayBuffer: 6144 bytes
   Decoding audio data...
   ✅ Decoded successfully: duration=0.384s, channels=1, sampleRate=24000
📝 Queued audio chunk (queue length: 1)
▶️ Starting playback (was not playing)
▶️ Playing audio chunk: duration=0.384s, channels=1, sampleRate=24000
   Scheduling: currentTime=0.123s, startTime=0.123s, nextPlayTime=0.000s
   Started playback at 0.123s
   Next chunk will start at 0.507s
✅ Audio chunk finished playing
✅ Audio queue empty, playback complete
```

## Common Issues and Solutions

### Issue: "⚠️ AudioContext suspended"
**Cause**: Browser autoplay policy
**Solution**: Already handled - code automatically calls `resume()` when suspended

### Issue: "❌ Failed to decode audio chunk"
**Cause**: Corrupt or invalid audio data from backend
**Solution**: Check backend audio synthesis and network transmission

### Issue: "⚠️ Scheduling gap detected"
**Cause**: Chunks arriving too slowly from backend or processing delays
**Solution**: May need backend optimization or buffering strategy

### Issue: "⚠️ Very short audio buffer detected"
**Cause**: Backend sending very small chunks
**Solution**: May need to buffer multiple small chunks before playback

## Performance Impact

- **Minimal overhead**: Logging can be disabled in production
- **No memory leaks**: Proper cleanup ensures resources are released
- **Efficient scheduling**: Uses native Web Audio API timing, no polling

## Next Steps (If Issues Persist)

1. **Reduce logging** - Remove verbose logs once stable
2. **Add buffering** - Implement min buffer threshold before playback starts
3. **Adjust chunk size** - Backend could send larger chunks for smoother streaming
4. **Add gain ramping** - Use `GainNode` with gradual fade-in/out to eliminate pops
5. **Monitor latency** - Track time between chunk arrival and playback

## Files Modified

- `/copilot-ui/src/components/SidecarView.tsx` - Complete refactor of Web Audio API implementation

## References

- [Web Audio API - AudioContext](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext)
- [Web Audio API - decodeAudioData](https://developer.mozilla.org/en-US/docs/Web/API/BaseAudioContext/decodeAudioData)
- [Web Audio API - AudioBufferSourceNode](https://developer.mozilla.org/en-US/docs/Web/API/AudioBufferSourceNode)
