const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const { getRecentActivities, getActivityStats } = require('../services/activityTracker');

// Get user activities with stats
router.get('/', authMiddleware, async (req, res) => {
    try {
        const activities = await getRecentActivities(req.user.id, 20);
        const stats = await getActivityStats(req.user.id, 7);

        // Format momentum data
        const momentum = {
            actionsThisWeek: stats.total,
            lastAction: activities[0] || null,
            momentum: stats.total > 5 ? 'HIGH' : stats.total > 2 ? 'MEDIUM' : 'LOW'
        };

        res.json({
            activities,
            momentum,
            stats
        });
    } catch (error) {
        console.error('Get activities error:', error);
        res.status(500).json({ error: { message: 'Failed to fetch activities' } });
    }
});

module.exports = router;
