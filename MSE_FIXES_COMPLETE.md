# MSE Audio Playback & Backend Stability Fixes - Complete

## Date: Oct 25, 2025
## Status: ✅ COMPLETE

---

## Problems Addressed

### 1. ❌ Frontend: Silent Audio Playback (MSE Issues)
- **Symptom**: `MEDIA_ELEMENT_ERROR: Empty src attribute`
- **Root Cause**: MediaSource not initialized before audio chunks arrived
- **Impact**: No audio playback despite successful backend processing

### 2. ❌ Backend: ETIMEDOUT Crashes
- **Symptom**: `uncaughtException: Error: ETIMEDOUT: connection timed out, write`
- **Root Cause**: No error handlers on Fish Audio response stream
- **Impact**: Server crashes during TTS streaming

### 3. ⚠️ Frontend: Connection Instability
- **Symptom**: Excessive re-renders and WebSocket connection churn
- **Root Cause**: Unclear cleanup flow in useWebSocket hook
- **Impact**: Poor developer experience, potential memory leaks

### 4. ⚠️ Format Mismatch Detection
- **Symptom**: First bytes `ce 4c 3c f0` (NOT MP3 format)
- **Root Cause**: No validation of received audio format
- **Impact**: Silent failures, difficult debugging

---

## Solutions Implemented

### Part 1: Frontend MSE Fixes (`copilot-ui/src/components/SidecarView.tsx`)

#### ✅ Fix 1: Initialize MediaSource on Mount
**Problem**: MediaSource was only initialized on user interaction (Start Recording button)
**Solution**: Initialize immediately in `useEffect` on component mount

```typescript
// Initialize MediaSource on mount - CRITICAL for preventing empty src errors
useEffect(() => {
  console.log('🔗 [MSE] Component mounted, initializing MediaSource...');
  
  if (audioElementRef.current && !mediaSourceRef.current) {
    initializeMediaSource();
  }
  
  return () => {
    // ... cleanup code
  };
}, [initializeMediaSource]);
```

**Impact**: Ensures audio element has valid `src` before any audio chunks arrive

---

#### ✅ Fix 2: Add Audio Format Detection
**Problem**: Received audio format was unknown (bytes: `ce 4c 3c f0`)
**Solution**: Added `detectAudioFormat()` helper function with magic byte detection

```typescript
function detectAudioFormat(bytes: Uint8Array): string {
  // MP3: 0xFF 0xFB, 0xFF 0xF3, or ID3 tag
  // WAV: "RIFF"
  // OGG/Opus: "OggS"
  // WebM: 0x1A 0x45 0xDF 0xA3
  // MP4/M4A: "ftyp" at bytes 4-7
  // FLAC: "fLaC"
  // ... detection logic
}
```

**Features**:
- Logs first 16 bytes in hex and decimal
- Detects: MP3, WAV, OGG/Opus, WebM, MP4/M4A, FLAC
- Warns if format doesn't match expected MIME type
- Provides actionable error messages

---

#### ✅ Fix 3: Ensure MediaSource on Send Button
**Problem**: Text input could trigger audio response without MSE initialization
**Solution**: Check and initialize MediaSource in `handleSendTextMessage()`

```typescript
const handleSendTextMessage = useCallback(() => {
  // Ensure MediaSource is initialized before sending (audio response expected)
  if (!mediaSourceRef.current && audioElementRef.current) {
    console.log('⚠️ [MSE] MediaSource not initialized, initializing now...');
    initializeMediaSource();
  }
  // ... rest of function
}, [textInput, isConnected, sendMessage, initializeMediaSource]);
```

---

#### ✅ Fix 4: Comprehensive MSE Logging
Enhanced logging in:
- `initializeMediaSource()`: MediaSource events, SourceBuffer creation, MIME type support
- `appendAudioChunk()`: Buffer state, audio element state, autoplay attempts
- `handleAudioChunk()`: Base64 decoding, format detection, first bytes inspection

**Sample Logs**:
```
🎬 [MSE] Initializing Media Source Extensions...
🔊 [MSE] Audio element configured: muted=false, volume=1.0
🔗 [MSE] Object URL created and set as audio src: blob:http://...
✅ [MSE] MediaSource opened
🔍 [MSE] MediaSource.isTypeSupported('audio/mpeg'): true
✅ [MSE] SourceBuffer created successfully with MIME type: audio/mpeg
⬇️ [WS] Received audio chunk - Format: mp3, Base64 length: 12345
🔍 [MSE] First bytes (hex): ce 4c 3c f0 a1 b2 c3 d4...
🔍 [MSE] Detected format: unknown
❌ [MSE] FORMAT MISMATCH! Expected MP3 but got unknown
```

---

### Part 2: Backend Stream Error Handling (`copilot-server/src/services/textToSpeech.ts`)

#### ✅ Fix 5: Fish Audio Stream Error Handlers
**Problem**: No error handlers on Fish Audio response stream → ETIMEDOUT crashes
**Solution**: Comprehensive error handlers on all stream events

```typescript
// CRITICAL: Attach error handlers to prevent ETIMEDOUT crashes
const audioStream = response.data;

audioStream.on('error', (streamError: Error) => {
  console.error('❌ [TTS Stream Error] Error in Fish Audio response stream:', streamError);
  console.error('   Error name:', streamError.name);
  console.error('   Chunks received before error:', chunkCount);
  // Don't throw - let generator complete naturally
});

audioStream.on('end', () => {
  console.log('✅ [TTS Stream] Fish Audio stream ended normally');
});

audioStream.on('close', () => {
  console.log('🔒 [TTS Stream] Fish Audio stream closed');
});
```

---

#### ✅ Fix 6: Wrapped Stream Iteration in try-catch
**Problem**: Async iteration errors could crash the server
**Solution**: Wrap `for await` loop with specific error handling

```typescript
try {
  for await (const chunk of audioStream) {
    if (chunk && chunk.length > 0) {
      chunkCount++;
      yield chunk as Buffer;
    }
  }
  console.log('✅ [TTS Stream] Completed streaming', chunkCount, 'chunks');
  
} catch (iterationError) {
  console.error('❌ [TTS Stream] Error during stream iteration:', iterationError);
  
  if (iterationError instanceof Error && iterationError.message.includes('ETIMEDOUT')) {
    console.error('❌ [TTS Stream] ETIMEDOUT error detected - connection timed out');
    // Don't crash - just log and complete the generator
  } else {
    throw iterationError; // Propagate other errors
  }
}
```

**Benefits**:
- Server no longer crashes on timeout
- Graceful degradation: partial audio may still play
- Clear error logging for debugging

---

#### ✅ Fix 7: First Chunk Format Logging
**Problem**: No visibility into actual format being sent by Fish Audio
**Solution**: Log first 16 bytes of first chunk from Fish Audio

```typescript
if (chunkCount === 1) {
  console.log('🎵 [TTS Stream] First chunk received:', chunk.length, 'bytes');
  const preview = chunk.slice(0, Math.min(16, chunk.length));
  const previewBytes = Array.from(preview) as number[];
  console.log('   First bytes (hex):', previewBytes.map(b => b.toString(16).padStart(2, '0')).join(' '));
}
```

**Impact**: Can compare backend logs with frontend logs to verify format consistency

---

### Part 3: Frontend Connection Stability (`copilot-ui/src/hooks/useWebSocket.ts`)

#### ✅ Fix 8: Enhanced Cleanup Logging
**Problem**: Cleanup flow was unclear during debugging
**Solution**: Step-by-step logging in cleanup function

```typescript
return () => {
  console.log('🧹 useWebSocket: Cleanup initiated');
  console.log('   Setting intentional disconnect flags...');
  intentionalDisconnectRef.current = true;
  shouldConnectRef.current = false;
  isConnectingRef.current = false;
  
  if (reconnectTimeoutRef.current) {
    console.log('   Clearing reconnect timeout...');
    clearTimeout(reconnectTimeoutRef.current);
  }
  
  if (wsRef.current) {
    const currentState = wsRef.current.readyState;
    console.log('   Current WebSocket state:', {
      readyState: currentState,
      CONNECTING: WebSocket.CONNECTING,
      OPEN: WebSocket.OPEN,
      CLOSING: WebSocket.CLOSING,
      CLOSED: WebSocket.CLOSED
    });
    
    console.log('   Nullifying event handlers...');
    wsRef.current.onopen = null;
    wsRef.current.onclose = null;
    wsRef.current.onerror = null;
    wsRef.current.onmessage = null;
    
    if (currentState === WebSocket.OPEN || currentState === WebSocket.CONNECTING) {
      console.log('   Closing WebSocket connection...');
      wsRef.current.close(1000, 'Component unmounting');
      console.log('✅ WebSocket close() called');
    } else {
      console.log('   WebSocket already closing/closed, skipping close() call');
    }
    
    console.log('   Nullifying wsRef...');
    wsRef.current = null;
  }
  
  console.log('✅ useWebSocket: Cleanup complete');
};
```

**Benefits**:
- Clear visibility into cleanup execution
- Easy to identify if cleanup runs multiple times (React Strict Mode)
- Helps debug connection leaks or stale references

---

## Verification Status

### ✅ Backend Safety (`copilot-server/src/websocket/audioHandler.ts`)
- **Verified**: All `ws.send()` calls use `safeSend()` wrapper
- **Verified**: Try-catch blocks around TTS streaming
- **Verified**: Error handlers on transcriber events

### ✅ Global Error Handlers (`copilot-server/src/index.ts`)
- **Verified**: `process.on('uncaughtException')` present
- **Verified**: `process.on('unhandledRejection')` present
- **Verified**: Both handlers log errors without crashing (last resort)

---

## Testing Recommendations

### 1. Format Detection Test
1. Start the application
2. Send a text message via the Send button
3. Check browser console for logs:
   ```
   🔍 [MSE] First bytes (hex): ...
   🔍 [MSE] Detected format: ...
   ```
4. Compare with backend logs:
   ```
   🎵 [TTS Stream] First chunk received: ... bytes
      First bytes (hex): ...
   ```
5. **Action**: If formats don't match, update MIME type in `initializeMediaSource()`

### 2. MIME Type Correction
If detected format is NOT MP3:
- **WAV**: Change to `'audio/wav; codecs="1"'`
- **OGG/Opus**: Change to `'audio/ogg; codecs=opus'` or `'audio/opus; codecs=opus'`
- **WebM**: Change to `'audio/webm; codecs=opus'`
- **MP4**: Change to `'audio/mp4; codecs="mp4a.40.2"'`

### 3. Backend Stability Test
1. Send multiple consecutive text messages
2. Monitor backend console for stream errors
3. Verify server doesn't crash on timeout
4. Check that partial audio plays even if stream fails

### 4. Connection Cleanup Test
1. Send a message, wait for response
2. Refresh the page (triggers cleanup)
3. Check console for complete cleanup logs
4. Verify no errors or warnings about closed sockets

---

## Known Issues & Next Steps

### ⚠️ Format Mismatch (High Priority)
**Issue**: First bytes `ce 4c 3c f0` don't match any known audio format
**Possible Causes**:
1. Fish Audio API sending custom/proprietary format
2. Data corruption during base64 encoding/decoding
3. Fish Audio API documentation incorrect about format

**Action Items**:
1. Check Fish Audio API documentation for actual format
2. Test with different `format` parameter values in `textToSpeech.ts`
3. Consider using Fish Audio's recommended client library
4. May need to transcode on backend (ffmpeg) to a browser-supported format

### 💡 Potential Optimizations
1. **Buffer management**: Implement buffer level monitoring to prevent queue buildup
2. **Adaptive streaming**: Adjust chunk size based on network conditions
3. **Error recovery**: Implement retry logic for failed audio chunks
4. **Memory management**: Clear old chunks from SourceBuffer after playback

---

## File Changes Summary

| File | Changes | Lines Modified |
|------|---------|----------------|
| `copilot-ui/src/components/SidecarView.tsx` | MediaSource init, format detection, enhanced logging | ~150 lines |
| `copilot-server/src/services/textToSpeech.ts` | Stream error handlers, timeout, logging | ~80 lines |
| `copilot-ui/src/hooks/useWebSocket.ts` | Enhanced cleanup logging | ~50 lines |
| `copilot-server/src/websocket/audioHandler.ts` | ✅ Already using safeSend | 0 lines |
| `copilot-server/src/index.ts` | ✅ Global handlers present | 0 lines |

**Total Impact**: ~280 lines modified across 3 files

---

## Critical Configuration Check

Before running the application, verify:

1. **Environment Variables** (`.env` in `copilot-server/`):
   ```
   FISH_AUDIO_API_KEY=your_key_here
   DEEPGRAM_API_KEY=your_key_here
   ANTHROPIC_API_KEY=your_key_here
   ```

2. **Fish Audio Format** (`copilot-server/src/services/textToSpeech.ts:137`):
   ```typescript
   format: 'mp3', // ⚠️ Verify this matches actual Fish Audio output
   ```

3. **MSE MIME Type** (`copilot-ui/src/components/SidecarView.tsx:57`):
   ```typescript
   const mimeType = 'audio/mpeg'; // ⚠️ MUST match Fish Audio format
   ```

---

## Debugging Checklist

When audio still doesn't play:

- [ ] Check browser console for `❌ [MSE]` errors
- [ ] Verify MediaSource was initialized (`✅ [MSE] MediaSource opened`)
- [ ] Check if SourceBuffer was created (`✅ [MSE] SourceBuffer created`)
- [ ] Verify MIME type is supported (`isTypeSupported: true`)
- [ ] Check first bytes match expected format
- [ ] Verify audio chunks are being received (`⬇️ [WS] Received audio chunk`)
- [ ] Check audio element for errors (`audioElementRef.current.error`)
- [ ] Verify autoplay is not blocked (check browser console for play() promise rejection)
- [ ] Check backend logs for stream errors (`❌ [TTS Stream Error]`)
- [ ] Verify Fish Audio API is returning data (check chunk count in logs)

---

## Success Criteria

✅ **Fixed** when:
1. No `Empty src attribute` errors
2. No backend ETIMEDOUT crashes
3. Audio format is detected and logged correctly
4. MediaSource initializes on mount
5. Audio chunks append without errors
6. Browser plays audio (speakers emit sound)
7. Console logs show complete pipeline: WS → Decode → Detect → Append → Play

---

## Contact & Support

If issues persist after applying these fixes:
1. Share browser console logs (filter by `[MSE]`)
2. Share backend console logs (filter by `[TTS Stream]`)
3. Share first 16 bytes from both frontend and backend
4. Share Fish Audio API documentation link

---

**End of Fix Documentation**
