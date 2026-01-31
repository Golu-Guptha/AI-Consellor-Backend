const axios = require('axios');
const FormData = require('form-data');

const deepgramApiKey = process.env.DEEPGRAM_API_KEY;

/**
 * Transcribe audio using Deepgram API
 * @param {Buffer} audioBuffer - Audio file buffer
 * @param {string} mimeType - Audio MIME type (e.g., 'audio/wav', 'audio/webm')
 * @returns {Promise<{transcript: string, confidence: number}>}
 */
async function transcribeAudio(audioBuffer, mimeType = 'audio/wav') {
    if (!deepgramApiKey) {
        throw new Error('DEEPGRAM_API_KEY not configured');
    }

    try {
        const response = await axios.post(
            'https://api.deepgram.com/v1/listen',
            audioBuffer,
            {
                headers: {
                    'Authorization': `Token ${deepgramApiKey}`,
                    'Content-Type': mimeType
                },
                params: {
                    model: 'nova-2',
                    smart_format: true,
                    punctuate: true,
                    language: 'en'
                }
            }
        );

        const result = response.data.results.channels[0].alternatives[0];

        return {
            transcript: result.transcript,
            confidence: result.confidence,
            words: result.words || []
        };
    } catch (error) {
        console.error('Deepgram transcription error:', error.response?.data || error.message);
        throw new Error('Speech transcription failed');
    }
}

/**
 * Transcribe audio from file path
 */
async function transcribeAudioFile(filePath) {
    const fs = require('fs');
    const audioBuffer = fs.readFileSync(filePath);

    // Determine MIME type from extension
    let mimeType = 'audio/wav';
    if (filePath.endsWith('.mp3')) mimeType = 'audio/mp3';
    else if (filePath.endsWith('.webm')) mimeType = 'audio/webm';
    else if (filePath.endsWith('.ogg')) mimeType = 'audio/ogg';

    return transcribeAudio(audioBuffer, mimeType);
}

module.exports = {
    transcribeAudio,
    transcribeAudioFile
};
