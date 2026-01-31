const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const { analyzeUniversityForDiscovery, batchAnalyzeUniversities } = require('../services/discoveryAnalysisService');

/**
 * GET /api/discovery/analyze/:universityId
 * Get AI analysis for a single university
 */
router.get('/analyze/:universityId', authMiddleware, async (req, res) => {
    try {
        const { universityId } = req.params;
        const userId = req.user.id;

        const analysis = await analyzeUniversityForDiscovery(userId, universityId);

        res.json({
            success: true,
            analysis
        });
    } catch (error) {
        console.error('Discovery analysis error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to analyze university',
            message: error.message
        });
    }
});

/**
 * POST /api/discovery/batch-analyze
 * Get AI analyses for multiple universities
 * Body: { university_ids: [...] }
 */
router.post('/batch-analyze', authMiddleware, async (req, res) => {
    try {
        const { university_ids } = req.body;
        const userId = req.user.id;

        if (!Array.isArray(university_ids) || university_ids.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'university_ids must be a non-empty array'
            });
        }

        // Limit batch size to prevent abuse
        if (university_ids.length > 50) {
            return res.status(400).json({
                success: false,
                error: 'Maximum 50 universities per batch'
            });
        }

        const analyses = await batchAnalyzeUniversities(userId, university_ids);

        res.json({
            success: true,
            analyses
        });
    } catch (error) {
        console.error('Batch analysis error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to batch analyze universities',
            message: error.message
        });
    }
});

module.exports = router;
