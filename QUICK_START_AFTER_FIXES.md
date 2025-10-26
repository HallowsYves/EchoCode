# Quick Start Guide - After MSE Fixes

## 🚀 Immediate Next Steps

### 1. Test the Application

```bash
# Terminal 1 - Start backend
cd copilot-server
npm run dev

# Terminal 2 - Start frontend
cd copilot-ui
npm run dev

# Terminal 3 - Optional: Start CLI watcher
cd copilot-cli
npm run dev
```

### 2. Open Browser Console (F12)

**Filter logs by**: `[MSE]` or `[TTS Stream]`

### 3. Send a Test Message

1. Click **Send** button or type a message
2. Watch for these critical logs:

```
✅ [MSE] MediaSource opened
✅ [MSE] SourceBuffer created successfully with MIME type: audio/mpeg
⬇️ [WS] Received audio chunk - Format: mp3, Base64 length: ...
🔍 [MSE] First bytes (hex): XX XX XX XX ...
🔍 [MSE] Detected format: ...
```

---

## ⚠️ CRITICAL: If Format is NOT MP3

### Scenario A: Detected format is WAV
**First bytes**: `52 49 46 46` ("RIFF")

**Fix**: In `copilot-ui/src/components/SidecarView.tsx` line 57:
```typescript
const mimeType = 'audio/wav; codecs="1"'; // Changed from 'audio/mpeg'
```

---

### Scenario B: Detected format is OGG/Opus
**First bytes**: `4F 67 67 53` ("OggS")

**Fix**: In `copilot-ui/src/components/SidecarView.tsx` line 57:
```typescript
const mimeType = 'audio/ogg; codecs=opus'; // Changed from 'audio/mpeg'
```

Also check if browser supports it:
```typescript
console.log('Opus support:', MediaSource.isTypeSupported('audio/ogg; codecs=opus'));
console.log('Opus alt:', MediaSource.isTypeSupported('audio/webm; codecs=opus'));
```

---

### Scenario C: Detected format is UNKNOWN
**First bytes**: `ce 4c 3c f0` or other unrecognized

**Possible Issues**:
1. **Data corruption** during base64 encoding
2. **Fish Audio API** sending unexpected format
3. **Wrong format parameter** in backend request

**Actions**:
1. Check backend logs for Fish Audio's actual response:
   ```
   🎵 [TTS Stream] First chunk received: ... bytes
      First bytes (hex): ...
   ```

2. Compare backend hex bytes with frontend hex bytes
   - If **different** → Base64 corruption issue
   - If **same** → Fish Audio sending unknown format

3. Check Fish Audio API documentation:
   - Verify supported `format` values
   - Check if `mp3` is actually supported
   - Try alternative formats: `wav`, `pcm`, `opus`

4. Test different format in `textToSpeech.ts` line 137:
   ```typescript
   format: 'wav', // Try: 'mp3', 'wav', 'pcm', 'opus'
   ```

---

## 🔍 Debugging Workflow

### Step 1: Verify Backend is Streaming
Check backend console for:
```
🎵 Sending TTS request to Fish Audio...
🎵 [TTS Stream] First chunk received: 8192 bytes
   First bytes (hex): XX XX XX XX ...
✅ [TTS Stream] Completed streaming X chunks
```

**If no chunks received**:
- Check Fish Audio API key
- Check Fish Audio account credits
- Check network connectivity
- Review Fish Audio API errors in console

---

### Step 2: Verify Frontend Receives Data
Check browser console for:
```
⬇️ [WS] Received audio chunk - Format: mp3, Base64 length: 10922
🔍 [MSE] First bytes (hex): XX XX XX XX ...
🔍 [MSE] Detected format: mp3
```

**If no data received**:
- Check WebSocket connection status
- Check network tab for WebSocket frames
- Verify `handleWebSocketMessage` is called

---

### Step 3: Verify MediaSource Setup
Check browser console for:
```
✅ [MSE] MediaSource opened
✅ [MSE] SourceBuffer created successfully with MIME type: audio/mpeg
```

**If SourceBuffer creation fails**:
- Check `isTypeSupported` result
- Try different MIME type
- Check browser compatibility

---

### Step 4: Verify Audio Appending
Check browser console for:
```
➡️ [MSE] Attempting to append buffer: 8192 bytes
✅ [MSE] Successfully appended audio chunk: 8192 bytes
🔄 [MSE] SourceBuffer updateend event fired
```

**If appending fails**:
- Check for `QuotaExceededError` (buffer too full)
- Check for format mismatch errors
- Verify buffer is not in updating state

---

### Step 5: Verify Audio Playback
Check browser console for:
```
▶️ [MSE] Attempting to start audio playback...
✅ [MSE] Audio playback started successfully
🎵 [Audio Element] playing event
⏱️ [Audio Element] timeupdate: 0.50s / 5.23s
```

**If playback fails**:
- Check for autoplay policy blocking (NotAllowedError)
  - **Fix**: User must click a button first
- Check audio element error:
  ```
  ❌ [Audio Element] Error detected: {code: 4, message: "..."}
  ```
- Check speaker volume and mute status

---

## 🐛 Common Errors & Fixes

### Error: "QuotaExceededError"
**Cause**: SourceBuffer is too full
**Fix**: Implement buffer cleanup (future enhancement)
**Workaround**: Refresh page between tests

---

### Error: "NotSupportedError" when creating SourceBuffer
**Cause**: Browser doesn't support the MIME type
**Fix**: Change MIME type to browser-supported format
**Check**: Run this in browser console:
```javascript
console.log('MP3:', MediaSource.isTypeSupported('audio/mpeg'));
console.log('MP4:', MediaSource.isTypeSupported('audio/mp4'));
console.log('WebM:', MediaSource.isTypeSupported('audio/webm'));
console.log('WAV:', MediaSource.isTypeSupported('audio/wav'));
```

---

### Error: "NotAllowedError" on play()
**Cause**: Browser autoplay policy
**Fix**: Ensure user interaction before first play attempt
**Note**: Clicking "Send" button should satisfy this requirement

---

### Backend: Server crashes with ETIMEDOUT
**Status**: Should be FIXED by new stream error handlers
**If still crashes**: Share full error stack trace

---

## 📊 Success Metrics

### ✅ Everything is Working When:
1. Console shows: `✅ [MSE] MediaSource opened`
2. Console shows: `✅ [MSE] SourceBuffer created`
3. Console shows: `⬇️ [WS] Received audio chunk`
4. Console shows: `🔍 [MSE] Detected format: mp3` (or other valid format)
5. Console shows: `✅ [MSE] Successfully appended audio chunk`
6. Console shows: `▶️ [Audio Element] playing event`
7. **SPEAKERS EMIT SOUND** 🔊

---

## 🔧 Advanced Debugging

### Inspect Audio Element State
Add this to browser console:
```javascript
const audioEl = document.querySelector('audio');
console.log({
  src: audioEl.src,
  readyState: audioEl.readyState,
  paused: audioEl.paused,
  currentTime: audioEl.currentTime,
  duration: audioEl.duration,
  muted: audioEl.muted,
  volume: audioEl.volume,
  error: audioEl.error
});
```

### Inspect MediaSource State
```javascript
// This will be logged automatically, but you can also check manually
// Look for MediaSource object in React DevTools or component state
```

### Inspect SourceBuffer State
```javascript
// Check console logs for updateend events
// Look for buffered time ranges in logs
```

---

## 📞 If Issues Persist

Collect and share:
1. **Browser console logs** (full output, filtered by `[MSE]`)
2. **Backend console logs** (full output, filtered by `[TTS Stream]`)
3. **First 16 bytes** from both frontend and backend
4. **Browser version** and OS
5. **MediaSource.isTypeSupported()** results for various formats
6. **Fish Audio API response** headers (if accessible)

---

## 🎯 Expected Timeline

- **Immediate**: MediaSource initialization on mount ✅
- **Immediate**: Enhanced error logging ✅
- **Immediate**: Backend crash prevention ✅
- **Next 5 minutes**: Format detection reveals actual format
- **Next 10 minutes**: MIME type corrected (if needed)
- **Next 15 minutes**: Audio playback working 🔊

---

## 🏆 Victory Condition

**You'll know it works when you hear the AI's voice through your speakers!** 🎉

If you don't hear audio after 15 minutes of debugging, share the logs as described above.

---

**Good luck! The fixes are comprehensive and should resolve all three major issues.**
