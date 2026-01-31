const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const supabase = require('../database/supabase');
const { logActivity } = require('../services/activityTracker');

// Get user shortlist
router.get('/', authMiddleware, async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('user_shortlists')
            .select(`
        *,
        university:universities(*)
      `)
            .eq('user_id', req.user.id)
            .order('added_at', { ascending: false });

        if (error) throw error;

        res.json({ shortlist: data || [] });
    } catch (error) {
        console.error('Get shortlist error:', error);
        res.status(500).json({ error: { message: 'Failed to fetch shortlist' } });
    }
});

// Add to shortlist
router.post('/', authMiddleware, async (req, res) => {
    try {
        const { university_id, category } = req.body;

        if (!university_id) {
            return res.status(400).json({ error: { message: 'university_id is required' } });
        }

        const { data, error } = await supabase
            .from('user_shortlists')
            .insert({
                user_id: req.user.id,
                university_id,
                category: category || 'TARGET'
            })
            .select(`
        *,
        university:universities(*)
      `)
            .single();

        if (error) {
            if (error.code === '23505') { // Unique constraint violation
                return res.status(409).json({ error: { message: 'University already in shortlist' } });
            }
            throw error;
        }

        // Log activity for AI awareness
        await logActivity(req.user.id, 'SHORTLIST_ADD', university_id, {
            university_name: data.university?.name,
            category: data.category,
            country: data.university?.country
        });

        // Trigger AI Analysis in background
        const { analyzeUniversityForUser } = require('../services/shortlistAnalysisService');
        analyzeUniversityForUser(req.user.id, university_id).catch(err =>
            console.error('Background analysis failed:', err)
        );

        res.json({ shortlist_item: data });
    } catch (error) {
        console.error('Add to shortlist error:', error);
        res.status(500).json({ error: { message: 'Failed to add to shortlist' } });
    }
});

// Update shortlist category
router.patch('/:id', authMiddleware, async (req, res) => {
    try {
        const { category } = req.body;

        if (!['DREAM', 'TARGET', 'SAFE'].includes(category)) {
            return res.status(400).json({ error: { message: 'Invalid category' } });
        }

        const { data, error } = await supabase
            .from('user_shortlists')
            .update({ category })
            .eq('id', req.params.id)
            .eq('user_id', req.user.id)
            .select()
            .single();

        if (error) throw error;

        res.json({ shortlist_item: data });
    } catch (error) {
        console.error('Update shortlist error:', error);
        res.status(500).json({ error: { message: 'Failed to update shortlist' } });
    }
});

// Remove from shortlist
router.delete('/:id', authMiddleware, async (req, res) => {
    try {
        // Get the shortlist item first to log university name
        const { data: shortlistItem } = await supabase
            .from('user_shortlists')
            .select('*, university:universities(*)')
            .eq('id', req.params.id)
            .eq('user_id', req.user.id)
            .single();

        const { error } = await supabase
            .from('user_shortlists')
            .delete()
            .eq('id', req.params.id)
            .eq('user_id', req.user.id);

        if (error) throw error;

        // Log activity
        if (shortlistItem) {
            await logActivity(req.user.id, 'SHORTLIST_REMOVE', shortlistItem.university_id, {
                university_name: shortlistItem.university?.name,
                category: shortlistItem.category
            });
        }

        res.json({ message: 'Removed from shortlist successfully' });
    } catch (error) {
        console.error('Remove from shortlist error:', error);
        res.status(500).json({ error: { message: 'Failed to remove from shortlist' } });
    }
});

module.exports = router;
