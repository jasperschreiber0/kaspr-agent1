const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');
const OpenAI = require('openai');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Map MIME types to content_type labels and file extensions
const MIME_MAP = {
  'image/jpeg':  { type: 'photo', ext: 'jpg' },
  'image/jpg':   { type: 'photo', ext: 'jpg' },
  'image/png':   { type: 'photo', ext: 'png' },
  'image/webp':  { type: 'photo', ext: 'webp' },
  'video/mp4':   { type: 'video', ext: 'mp4' },
  'video/quicktime': { type: 'video', ext: 'mov' },
  'audio/ogg':   { type: 'voice', ext: 'ogg' },
  'audio/mpeg':  { type: 'voice', ext: 'mp3' },
  'audio/mp4':   { type: 'voice', ext: 'mp4' },
};

/**
 * Download a single media item from Twilio and upload to Supabase Storage.
 * Returns { storagePath, contentType } or throws.
 */
async function downloadAndStore(mediaUrl, mimeType, clientId) {
  const mapping = MIME_MAP[mimeType];
  if (!mapping) {
    throw new Error(`Unsupported file type: ${mimeType}`);
  }

  // Download from Twilio (requires basic auth)
  const response = await axios.get(mediaUrl, {
    responseType: 'arraybuffer',
    auth: {
      username: process.env.TWILIO_ACCOUNT_SID,
      password: process.env.TWILIO_AUTH_TOKEN,
    },
  });

  const buffer = Buffer.from(response.data);
  const timestamp = Date.now();
  const filename = `${timestamp}.${mapping.ext}`;
  const storagePath = `clients/${clientId}/raw/${filename}`;

  // Upload to Supabase Storage bucket: kaspr-media
  const { error } = await supabase.storage
    .from('kaspr-media')
    .upload(storagePath, buffer, {
      contentType: mimeType,
      upsert: false,
    });

  if (error) {
    console.error('[mediaHandler] Storage upload error:', error.message);
    throw new Error('Storage upload failed');
  }

  return { storagePath, contentType: mapping.type };
}

/**
 * Transcribe a voice note using OpenAI Whisper.
 * Expects a Supabase storage path; downloads it first.
 * Returns transcript string or null on failure.
 */
async function transcribeVoice(storagePath) {
  try {
    // Get signed URL from Supabase
    const { data, error } = await supabase.storage
      .from('kaspr-media')
      .createSignedUrl(storagePath, 60);

    if (error || !data?.signedUrl) {
      console.error('[mediaHandler] Could not get signed URL for transcription');
      return null;
    }

    // Download the audio file
    const audioResponse = await axios.get(data.signedUrl, {
      responseType: 'arraybuffer',
    });

    const audioBuffer = Buffer.from(audioResponse.data);

    // Whisper requires a File-like object — use a Blob
    const { Blob } = require('buffer');
    const audioBlob = new Blob([audioBuffer], { type: 'audio/ogg' });
    const file = new File([audioBlob], 'voice.ogg', { type: 'audio/ogg' });

    const transcription = await openai.audio.transcriptions.create({
      file,
      model: 'whisper-1',
      language: 'en',
    });

    return transcription.text || null;
  } catch (err) {
    console.error('[mediaHandler] Whisper transcription failed:', err.message);
    return null;
  }
}

/**
 * Handle all media items from a single inbound WhatsApp message.
 * Returns array of { storagePath, contentType } objects.
 */
async function handleMediaItems(body, clientId) {
  const numMedia = parseInt(body.NumMedia || '0', 10);
  const results = [];

  for (let i = 0; i < numMedia; i++) {
    const mediaUrl = body[`MediaUrl${i}`];
    const mimeType = body[`MediaContentType${i}`];

    if (!mediaUrl || !mimeType) continue;

    try {
      const result = await downloadAndStore(mediaUrl, mimeType, clientId);
      results.push(result);
    } catch (err) {
      if (err.message.includes('Unsupported file type')) {
        throw err; // Bubble up so webhook can reply to user
      }
      console.error(`[mediaHandler] Failed on media item ${i}:`, err.message);
      // Retry once
      try {
        const result = await downloadAndStore(mediaUrl, mimeType, clientId);
        results.push(result);
      } catch (retryErr) {
        console.error(`[mediaHandler] Retry failed on media item ${i}:`, retryErr.message);
        throw retryErr;
      }
    }
  }

  return results;
}

module.exports = { handleMediaItems, transcribeVoice };
