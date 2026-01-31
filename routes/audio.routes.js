const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const multer = require('multer');
const { transcribeAudio } = require('../services/transcriptionService');
const path = require('path');
const fs = require('fs');

// Configure multer for file uploads
const upload = multer({
    dest: 'uploads/',
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
    fileFilter: (req, file, cb) => {
        const allowedTypes = ['audio/wav', 'audio/webm', 'audio/mp3', 'audio/ogg', 'audio/mpeg'];
        if (allowedTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Invalid audio format. Allowed: WAV, WebM, MP3, OGG'));
        }
    }
});

// Transcribe audio endpoint
router.post('/transcribe', authMiddleware, upload.single('audio'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: { message: 'No audio file provided' } });
        }

        const audioBuffer = fs.readFileSync(req.file.path);
        const mimeType = req.file.mimetype;

        // Transcribe with Deepgram
        const result = await transcribeAudio(audioBuffer, mimeType);

        // Delete uploaded file
        fs.unlinkSync(req.file.path);

        res.json({
            transcript: result.transcript,
            confidence: result.confidence,
            warning: result.confidence < 0.8 ? 'Low confidence transcription - please review' : null
        });
    } catch (error) {
        // Clean up file on error
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }

        console.error('Transcription error:', error);
        res.status(500).json({ error: { message: error.message || 'Transcription failed' } });
    }
});

module.exports = router;
