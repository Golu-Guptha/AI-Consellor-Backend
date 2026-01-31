const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const { searchUniversities, manualAddUniversity } = require('../services/universityService');
const { enrichUniversity } = require('../services/aiService');
const { calculateAcceptanceScore } = require('../utils/acceptanceScore');
const supabase = require('../database/supabase');

// Search universities
router.get('/search', authMiddleware, async (req, res) => {
    try {
        const { name, country, minTuition, maxTuition, field } = req.query;

        if (!name && !country) {
            return res.status(400).json({ error: { message: 'Please provide at least name or country' } });
        }

        // Search and cache
        const universities = await searchUniversities({
            name,
            country,
            enrichUS: country === 'United States' || country === 'US'
        });

        // Filter by tuition if specified
        let filtered = universities;
        if (minTuition || maxTuition) {
            filtered = filtered.filter(uni => {
                if (!uni.tuition_estimate) return true; // Keep if no tuition data
                if (minTuition && uni.tuition_estimate < minTuition) return false;
                if (maxTuition && uni.tuition_estimate > maxTuition) return false;
                return true;
            });
        }

        res.json({ universities: filtered, total: filtered.length });
    } catch (error) {
        console.error('University search error:', error);
        res.status(500).json({ error: { message: 'University search failed' } });
    }
});

// Get university by ID
router.get('/:id', authMiddleware, async (req, res) => {
    try {
        const { data: university, error } = await supabase
            .from('universities')
            .select('*')
            .eq('id', req.params.id)
            .single();

        if (error) throw error;

        // Get user profile
        const { data: profile } = await supabase
            .from('profiles')
            .select('*')
            .eq('user_id', req.user.id)
            .single();

        const acceptanceInfo = profile
            ? calculateAcceptanceScore(profile, university)
            : null;

        res.json({
            university: {
                ...university,
                acceptance_score: acceptanceInfo
            }
        });
    } catch (error) {
        console.error('Get university error:', error);
        res.status(404).json({ error: { message: 'University not found' } });
    }
});

// Manual Add University
router.post('/manual', authMiddleware, async (req, res) => {
    try {
        const { name, country } = req.body;

        if (!name || !country) {
            return res.status(400).json({ error: { message: 'Name and Country are required' } });
        }

        const university = await manualAddUniversity(req.body, req.user.id);
        res.status(201).json({ university });
    } catch (error) {
        console.error('Manual add error:', error);
        res.status(500).json({ error: { message: 'Failed to add university' } });
    }
});

// AI Enrich University Data
router.post('/enrich', authMiddleware, async (req, res) => {
    try {
        const { name, country } = req.body;

        if (!name || !country) {
            return res.status(400).json({ error: { message: 'Name and Country are required' } });
        }

        console.log(`Enriching university: ${name}, ${country}`);
        const enrichedData = await enrichUniversity(name, country);

        // Check if enrichment had errors
        if (enrichedData.error) {
            console.log('Enrichment returned error:', enrichedData.error);
            return res.json({ enrichedData }); // Still return it so frontend can handle
        }

        res.json({ enrichedData });
    } catch (error) {
        console.error('Enrich error:', error.message, error.stack);
        res.status(500).json({
            error: {
                message: error.message || 'Failed to enrich university data',
                details: process.env.NODE_ENV === 'development' ? error.stack : undefined
            }
        });
    }
});

module.exports = router;
