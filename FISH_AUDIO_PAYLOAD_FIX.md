# Fish Audio TTS Payload Fix - 400 Bad Request

## Date: October 25, 2025

## Problem Summary

The Fish Audio TTS API was returning **400 Bad Request** errors due to an invalid payload containing:
1. ❌ `reference_id: "default_voice"` - Not a valid voice UUID
2. ❌ `opus_bitrate: -1000` - Invalid parameter (negative value, and irrelevant for MP3 format)

Additionally, the error logging was attempting to `JSON.stringify()` the circular Axios error object, causing a `TypeError`.

---

## Root Cause Analysis

### Invalid Payload Parameters

**Original Payload (BROKEN):**
```json
{
  "text": "...",
  "reference_id": "default_voice",  ❌ Invalid - not a real UUID
  "format": "mp3",
  "mp3_bitrate": 128,
  "normalize": true,
  "opus_bitrate": -1000,              ❌ Invalid - wrong format parameter
  "latency": "normal"
}
```

**Issues:**
1. **`reference_id: "default_voice"`**: This is not a valid Fish Audio voice UUID. Voice IDs should be UUIDs (e.g., `"550e8400-e29b-41d4-a716-446655440000"`). The string `"default_voice"` was likely causing the 400 error.

2. **`opus_bitrate: -1000`**: This parameter is:
   - Invalid because it's negative
   - Irrelevant because `format` is set to `"mp3"`, not `"opus"`
   - Likely causing the API to reject the entire request

3. **`normalize: true`**: While not necessarily invalid, this parameter may not be supported by all Fish Audio endpoints or plans.

### Error Logging Issues

**Original Error Handling (PROBLEMATIC):**
```typescript
console.error('Fish Audio API Error:', error.response?.data);
throw new Error(
  `Fish Audio API error: ${status} ${statusText} - ${JSON.stringify(error.response?.data)}`
);
```

**Problems:**
- Axios error objects contain circular references (e.g., `config.request → request.config`)
- `JSON.stringify()` on circular objects throws `TypeError: Converting circular structure to JSON`
- Didn't log the actual request payload that caused the error
- Made debugging harder

---

## Solutions Implemented

### 1. Fixed API Payload

**New Payload (FIXED):**
```typescript
const requestPayload = {
  text,
  // reference_id: 'your-voice-uuid-here', // Omitted to use default voice
  format: 'mp3',          // Supported: mp3, wav, pcm, opus
  mp3_bitrate: 128,       // 128 or 192 kbps for mp3
  latency: 'normal',      // 'normal' or 'balanced'
};
```

**Changes:**
- ✅ Removed `reference_id` entirely - Fish Audio will use the default voice
- ✅ Removed `opus_bitrate` - Not valid for MP3 format
- ✅ Removed `normalize` - Simplified to essential parameters
- ✅ Added comments explaining valid values
- ✅ Created a variable so the payload is logged before sending

### 2. Enhanced Request Logging

**Added pre-request logging:**
```typescript
console.log('🎵 Sending TTS request to Fish Audio...');
console.log('   Text length:', text.length, 'characters');
console.log('   Payload:', JSON.stringify(requestPayload, null, 2));
```

This lets you see EXACTLY what's being sent before the request is made.

### 3. Improved Error Handling

**New error handling approach:**
```typescript
catch (error: any) {
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
  
  // ... specific status code handling
}
```

**Key Improvements:**
- ✅ Logs the actual request that failed (URL, method, payload, headers)
- ✅ Redacts the Authorization header for security
- ✅ Avoids circular reference issues by accessing specific properties
- ✅ Safely serializes response data with try/catch
- ✅ Added network error handling (no response received)

### 4. Better 400 Error Messaging

**Enhanced 400 Bad Request handler:**
```typescript
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
```

**Improvements:**
- ✅ Lists common causes of 400 errors
- ✅ Provides actionable troubleshooting steps
- ✅ Safely handles response data serialization
- ✅ Includes the API's error message in the thrown error

---

## Testing the Fix

### Expected Success Flow

When the API call succeeds, you should see:

```
🎵 Sending TTS request to Fish Audio...
   Text length: 42 characters
   Payload: {
  "text": "Hello, this is a test of the TTS system.",
  "format": "mp3",
  "mp3_bitrate": 128,
  "latency": "normal"
}
```

Then audio chunks will stream back.

### If 400 Error Still Occurs

If you still get a 400 error, the new logging will show:

```
❌ Error synthesizing speech: Request failed with status code 400

📤 Request Details:
   URL: https://api.fish.audio/v1/tts
   Method: POST
   Payload: {"text":"...","format":"mp3","mp3_bitrate":128,"latency":"normal"}
   Headers: { Authorization: '***REDACTED***', Content-Type: 'application/json' }

--------------------------------------------------------------
FISH AUDIO API ERROR: 400 Bad Request

The request parameters are invalid or malformed.

Response Data: {
  "error": "Invalid parameter: latency must be 'balanced' not 'normal'"
}

Common causes:
• Invalid or missing 'reference_id' (voice UUID)
...
```

This gives you:
1. The exact payload sent
2. The API's specific error message
3. Guidance on what to check

### Possible Next Steps If Error Persists

If the simplified payload still returns 400:

1. **Check Fish Audio API Documentation**: The API may have changed or your account may use a different endpoint
   - Visit: https://fish.audio/docs

2. **Try Even Simpler Payload**:
   ```typescript
   const requestPayload = {
     text,
     // Only the absolute minimum
   };
   ```

3. **Use `getAvailableVoices()`**: Call this function first to see what's available:
   ```typescript
   const voices = await getAvailableVoices();
   console.log('Available voices:', voices);
   ```

4. **Check for Required Parameters**: The API might require a `reference_id`. If so, you need to:
   - Log into your Fish Audio account
   - Find a valid voice UUID
   - Add it back to the payload

5. **Verify API Endpoint**: Confirm the endpoint is `https://api.fish.audio/v1/tts` and not a different version or path

---

## Alternative: Using a Valid Voice ID

If the API requires a `reference_id`, you can get one by:

### Option 1: Call `getAvailableVoices()`
```typescript
const voices = await getAvailableVoices();
// Use the first available voice
const voiceId = voices[0]?.id;
```

### Option 2: Hardcode a Known Voice ID
```typescript
const requestPayload = {
  text,
  reference_id: 'YOUR_VALID_VOICE_UUID_HERE',
  format: 'mp3',
  mp3_bitrate: 128,
  latency: 'normal',
};
```

---

## Files Modified

- ✅ `copilot-server/src/services/textToSpeech.ts`
  - Fixed API request payload
  - Removed invalid parameters
  - Added pre-request logging
  - Improved error handling to avoid circular reference issues
  - Enhanced error messages with troubleshooting guidance

---

## Summary

### What Was Broken
1. Invalid `reference_id: "default_voice"` (not a real UUID)
2. Invalid `opus_bitrate: -1000` (wrong format, negative value)
3. Error logging attempted to stringify circular Axios error objects

### What Was Fixed
1. Removed `reference_id` to use Fish Audio's default voice
2. Removed `opus_bitrate` parameter
3. Added request payload logging before sending
4. Improved error logging to show actual request details
5. Safely serialize response data to avoid circular reference errors
6. Added comprehensive 400 error troubleshooting guidance

### Expected Result
✅ The TTS request should now succeed with a valid payload
✅ If it still fails, you'll get clear, actionable error messages showing exactly what was sent and why it failed
