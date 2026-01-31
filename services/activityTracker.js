const supabase = require('../database/supabase');

/**
 * Activity Types:
 * - SHORTLIST_ADD: User added university to shortlist
 * - SHORTLIST_REMOVE: User removed university from shortlist  
 * - LOCK_UNIVERSITY: User locked a university
 * - UNLOCK_UNIVERSITY: User unlocked a university
 * - TASK_CREATE: User created a task
 * - TASK_UPDATE: User updated task status
 * - TASK_COMPLETE: User completed a task
 * - SEARCH_UNIVERSITY: User searched for universities
 * - PROFILE_UPDATE: User updated their profile
 */

/**
 * Log user activity for AI awareness
 * @param {string} userId - User ID
 * @param {string} activityType - Type of activity (see above)
 * @param {string|null} entityId - Related entity ID (university, task, etc.)
 * @param {object} metadata - Additional context
 */
async function logActivity(userId, activityType, entityId = null, metadata = {}) {
    try {
        const { error } = await supabase
            .from('user_activities')
            .insert({
                user_id: userId,
                activity_type: activityType,
                entity_id: entityId,
                metadata
            });

        if (error) {
            console.error('Activity logging error:', error);
        }
    } catch (error) {
        // Don't fail the main operation if activity logging fails
        console.error('Failed to log activity:', error.message);
    }
}

/**
 * Get recent activities for a user
 * @param {string} userId - User ID
 * @param {number} limit - Max activities to return
 * @returns {Array} Array of recent activities
 */
async function getRecentActivities(userId, limit = 20) {
    try {
        const { data, error } = await supabase
            .from('user_activities')
            .select('*')
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .limit(limit);

        if (error) throw error;
        return data || [];
    } catch (error) {
        console.error('Failed to fetch activities:', error.message);
        return [];
    }
}

/**
 * Get activity statistics for a user
 * @param {string} userId - User ID
 * @param {number} days - Number of days to look back
 * @returns {object} Activity statistics
 */
async function getActivityStats(userId, days = 7) {
    try {
        const since = new Date();
        since.setDate(since.getDate() - days);

        const { data, error } = await supabase
            .from('user_activities')
            .select('activity_type, created_at')
            .eq('user_id', userId)
            .gte('created_at', since.toISOString());

        if (error) throw error;

        const activities = data || [];
        const byType = {};

        activities.forEach(activity => {
            byType[activity.activity_type] = (byType[activity.activity_type] || 0) + 1;
        });

        return {
            total: activities.length,
            byType,
            lastActivity: activities[0] || null,
            days
        };
    } catch (error) {
        console.error('Failed to fetch activity stats:', error.message);
        return { total: 0, byType: {}, lastActivity: null, days };
    }
}

module.exports = {
    logActivity,
    getRecentActivities,
    getActivityStats
};
