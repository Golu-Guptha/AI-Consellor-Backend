const express = require('express');
const router = express.Router();
const { getCacheStats, clearExpiredCache } = require('../services/cacheService');
const authMiddleware = require('../middleware/auth');

// Get cache statistics
router.get('/stats', authMiddleware, async (req, res) => {
    try {
        const stats = await getCacheStats();
        res.json({ stats });
    } catch (error) {
        console.error('Cache stats error:', error);
        res.status(500).json({ error: { message: 'Failed to get cache stats' } });
    }
});

// Clear expired cache entries (admin/cron task)
router.post('/clear-expired', authMiddleware, async (req, res) => {
    try {
        await clearExpiredCache();
        res.json({ message: 'Expired cache entries cleared successfully' });
    } catch (error) {
        console.error('Clear cache error:', error);
        res.status(500).json({ error: { message: 'Failed to clear cache' } });
    }
});

module.exports = router;
