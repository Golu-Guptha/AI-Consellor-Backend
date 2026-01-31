const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const supabase = require('../database/supabase');
const { calculateProfileStrength } = require('../utils/acceptanceScore');
const { invalidateUserCache } = require('../services/discoveryAnalysisService');
const { analyzeUniversityForUser } = require('../services/shortlistAnalysisService');
const { syncTasksWithProfile } = require('../services/taskGenerator');
const Joi = require('joi');

// Validation schema
const profileSchema = Joi.object({
    education_level: Joi.string().valid('HS', 'Bachelors', 'Masters', 'MBA', 'PhD').required(),
    degree_major: Joi.string().allow('', null),
    grad_year: Joi.number().integer().min(1950).max(2030).allow(null),
    gpa: Joi.number().min(0).max(4.0).allow(null),
    target_degree: Joi.string().valid('Bachelors', 'Masters', 'MBA', 'PhD').required(),
    field_of_study: Joi.string().required(),
    intake_year: Joi.number().integer().min(2024).max(2030).required(),
    preferred_countries: Joi.array().items(Joi.string()).required(),
    budget_min: Joi.number().integer().min(0).allow(null),
    budget_max: Joi.number().integer().min(0).allow(null),
    funding_plan: Joi.string().valid('Self-Funded', 'Scholarship', 'Loan', 'Mixed').allow(null),
    ielts_score: Joi.number().min(0).max(9).allow(null),
    toefl_score: Joi.number().integer().min(0).max(120).allow(null),
    gre_score: Joi.number().integer().min(260).max(340).allow(null),
    gmat_score: Joi.number().integer().min(200).max(800).allow(null),
    sop_status: Joi.string().valid('NOT_STARTED', 'DRAFT', 'READY').default('NOT_STARTED')
});

// Get user profile
router.get('/', authMiddleware, async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('profiles')
            .select('*')
            .eq('user_id', req.user.id)
            .single();

        if (error && error.code !== 'PGRST116') { // PGRST116 = no rows
            throw error;
        }

        if (!data) {
            return res.status(404).json({ error: { message: 'Profile not found' } });
        }

        // Calculate profile strength
        const strength = calculateProfileStrength(data);

        res.json({ profile: data, strength });
    } catch (error) {
        console.error('Get profile error:', error);
        res.status(500).json({ error: { message: 'Failed to fetch profile' } });
    }
});

// Create or update profile
router.post('/', authMiddleware, async (req, res) => {
    try {
        console.log('📝 Profile save request:', {
            user_id: req.user.id,
            body: req.body
        });

        // Validate input
        const { error: validationError, value } = profileSchema.validate(req.body);
        if (validationError) {
            console.log('❌ Validation error:', validationError.details[0].message);
            return res.status(400).json({ error: { message: validationError.details[0].message } });
        }

        // Check if profile is complete
        const isComplete = !!(
            value.education_level &&
            value.target_degree &&
            value.field_of_study &&
            value.intake_year &&
            value.preferred_countries.length > 0 &&
            (value.budget_min || value.budget_max)
        );

        const profileData = {
            ...value,
            user_id: req.user.id,
            profile_complete: isComplete,
            updated_at: new Date().toISOString()
        };

        console.log('📊 Profile data to save:', profileData);

        // Upsert profile
        const { data, error } = await supabase
            .from('profiles')
            .upsert(profileData, { onConflict: 'user_id' })
            .select()
            .single();

        if (error) {
            console.log('❌ Supabase error:', error);
            throw error;
        }

        console.log('✅ Profile saved successfully');

        // Calculate strength
        const strength = calculateProfileStrength(data);

        // Trigger background updates
        triggerRealtimeUpdates(req.user.id, data);

        res.json({
            profile: data,
            strength,
            message: isComplete ? 'Profile completed successfully' : 'Profile saved (incomplete)'
        });
    } catch (error) {
        console.error('💥 Save profile error:', error.message, error.details || error);
        res.status(500).json({ error: { message: 'Failed to save profile', details: error.message } });
    }
});

// Update specific fields
router.patch('/', authMiddleware, async (req, res) => {
    try {
        const updates = req.body;
        updates.updated_at = new Date().toISOString();

        const { data, error } = await supabase
            .from('profiles')
            .update(updates)
            .eq('user_id', req.user.id)
            .select()
            .single();

        if (error) throw error;

        const strength = calculateProfileStrength(data);

        // Trigger background updates
        triggerRealtimeUpdates(req.user.id, data);

        res.json({ profile: data, strength });
    } catch (error) {
        console.error('Update profile error:', error);
        res.status(500).json({ error: { message: 'Failed to update profile' } });
    }
});

// Helper to trigger background updates
async function triggerRealtimeUpdates(userId, profileData) {
    // 1. Invalidate Discovery Cache (so new recs are generated)
    invalidateUserCache(userId).catch(err =>
        console.error('Background cache invalidation failed:', err)
    );

    // 2. Sync Tasks (generate missing tasks)
    syncTasksWithProfile(userId, profileData).catch(err =>
        console.error('Background task sync failed:', err)
    );

    // 3. Re-analyze Shortlist (update chances)
    // Fetch shortlist items
    supabase.from('user_shortlists')
        .select('university_id')
        .eq('user_id', userId)
        .then(({ data: shortlist }) => {
            if (shortlist && shortlist.length > 0) {
                console.log(`🔄 Triggering re-analysis for ${shortlist.length} shortlisted universities...`);
                // Process sequentially to avoid overwhelming AI
                shortlist.reduce(async (previousPromise, item) => {
                    await previousPromise;
                    return analyzeUniversityForUser(userId, item.university_id);
                }, Promise.resolve())
                    .then(() => console.log('✅ Background shortlist re-analysis complete'))
                    .catch(err => console.error('Background shortlist analysis failed:', err));
            }
        });
}

module.exports = router;
