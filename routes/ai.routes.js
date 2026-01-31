const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const { generateAIResponse } = require('../services/aiService');
const supabase = require('../database/supabase');

// Rate limiting for AI endpoint (stricter)
const rateLimit = require('express-rate-limit');
const aiLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 10 // 10 requests per minute per IP
});

// AI reasoning endpoint
router.post('/reason', authMiddleware, aiLimiter, async (req, res) => {
    try {
        const { user_query, mode = 'COUNSELLOR', formData = {}, conversationId } = req.body;

        if (!conversationId) {
            return res.status(400).json({ error: { message: 'Conversation ID is required' } });
        }

        // 1. Save User Message
        const { error: userMsgError } = await supabase
            .from('chat_messages')
            .insert({
                conversation_id: conversationId,
                role: 'user',
                content: user_query
            });

        if (userMsgError) throw userMsgError;

        // 2. Check if conversation needs naming (first message)
        const { data: conversation } = await supabase
            .from('chat_conversations')
            .select('title, created_at')
            .eq('id', conversationId)
            .single();

        if (conversation && conversation.title === 'New Conversation') {
            // Check if this is indeed the first message (or close to it)
            const { count } = await supabase
                .from('chat_messages')
                .select('*', { count: 'exact', head: true })
                .eq('conversation_id', conversationId);

            if (count <= 2) { // Allow for a small buffer
                // Auto-name based on user query (simple truncation for speed, or could use AI)
                const newTitle = user_query.length > 50
                    ? user_query.substring(0, 50) + '...'
                    : user_query;

                await supabase
                    .from('chat_conversations')
                    .update({ title: newTitle })
                    .eq('id', conversationId);
            }
        }

        // 3. Generate AI response with full context
        // In a real implementation, we would ideally fetch recent chat history here to pass as context
        const aiResponse = await generateAIResponse({
            userQuery: user_query,
            userId: req.user.id,
            mode,
            currentFormData: formData
        });

        // 4. Save AI Message
        const { error: aiMsgError } = await supabase
            .from('chat_messages')
            .insert({
                conversation_id: conversationId,
                role: 'assistant',
                content: aiResponse.text
            });

        if (aiMsgError) throw aiMsgError;

        // Update conversation timestamp
        await supabase
            .from('chat_conversations')
            .update({ updated_at: new Date() })
            .eq('id', conversationId);


        // Process actions (validate and prepare for execution)
        const validatedActions = [];
        for (const action of aiResponse.actions || []) {
            // Validate action types
            if (['SUGGEST_SHORTLIST', 'CREATE_TASK', 'RECOMMEND_LOCK', 'UPDATE_ONBOARDING_STATE'].includes(action.type)) {
                validatedActions.push(action);
            }
        }

        // Log to audit_logs
        await supabase.from('audit_logs').insert({
            user_id: req.user.id,
            action_type: 'AI_REASONING',
            payload: {
                query: user_query,
                actions: validatedActions,
                conversation_id: conversationId
            }
        });

        res.json({
            text: aiResponse.text,
            actions: validatedActions,
            suggested_options: aiResponse.suggested_options || null,
            reasoning: aiResponse.reasoning || {},
            recommendations: aiResponse.recommendations || [],
            nextSteps: aiResponse.nextSteps || []
        });
    } catch (error) {
        console.error('AI reasoning error:', error);

        // Check if it's a rate limit error from AI services
        if (error.message.includes('AI service unavailable') || error.message.includes('not configured')) {
            return res.status(503).json({
                error: {
                    message: 'AI service temporarily unavailable. Please check API configuration.',
                    retry: true
                }
            });
        }

        res.status(500).json({ error: { message: 'AI reasoning failed: ' + error.message } });
    }
});

// Execute AI action
router.post('/execute-action', authMiddleware, async (req, res) => {
    const { logActivity } = require('../services/activityTracker');
    const { findOrCreateUniversity } = require('../services/universityEnrichment');

    try {
        const { action } = req.body;

        if (!action || !action.type) {
            return res.status(400).json({ error: { message: 'Invalid action' } });
        }

        let result;

        switch (action.type) {
            case 'SUGGEST_SHORTLIST':
                // Try to find university, or use AI to enrich and create it
                let university;
                try {
                    university = await findOrCreateUniversity(
                        action.payload.univ_external_id,
                        action.payload.country
                    );
                } catch (enrichError) {
                    console.error('University enrichment failed:', enrichError);
                    return res.status(404).json({
                        error: {
                            message: `Could not find or create university: ${enrichError.message}`
                        }
                    });
                }

                // Check if already in shortlist
                const { data: existingShortlist } = await supabase
                    .from('user_shortlists')
                    .select('id')
                    .eq('user_id', req.user.id)
                    .eq('university_id', university.id)
                    .single();

                if (existingShortlist) {
                    return res.status(409).json({
                        error: { message: 'University already in shortlist' }
                    });
                }

                // Add to shortlist
                const { data: shortlistData, error: shortlistError } = await supabase
                    .from('user_shortlists')
                    .insert({
                        user_id: req.user.id,
                        university_id: university.id,
                        category: action.payload.category || 'TARGET'
                    })
                    .select();

                if (shortlistError) throw shortlistError;

                // Log activity
                await logActivity(req.user.id, 'SHORTLIST_ADD', university.id, {
                    university_name: university.name,
                    category: action.payload.category || 'TARGET',
                    added_by: 'AI',
                    ai_enriched: university.data_source === 'OTHER'
                });

                // Trigger AI Analysis in background (same as shortlist.routes.js)
                const { analyzeUniversityForUser } = require('../services/shortlistAnalysisService');
                analyzeUniversityForUser(req.user.id, university.id).catch(err =>
                    console.error('Background analysis failed:', err)
                );

                result = {
                    ...shortlistData,
                    university,
                    ai_enriched: university.data_source === 'OTHER'
                };
                break;

            case 'CREATE_TASK':
                const { data: taskData, error: taskError } = await supabase
                    .from('tasks')
                    .insert({
                        user_id: req.user.id,
                        title: action.payload.title,
                        description: action.payload.description,
                        due_date: action.payload.due_date,
                        related_university_id: action.payload.related_university_id || null,
                        created_by: 'AI'
                    })
                    .select();

                if (taskError) throw taskError;

                // Log activity
                await logActivity(req.user.id, 'TASK_CREATE', taskData[0].id, {
                    task_title: taskData[0].title,
                    created_by: 'AI'
                });

                result = taskData;
                break;

            case 'RECOMMEND_LOCK':
                // Just return recommendation, don't auto-lock
                result = { message: 'Lock recommendation noted', payload: action.payload };
                break;

            default:
                return res.status(400).json({ error: { message: 'Unknown action type' } });
        }

        // Log action execution
        await supabase.from('audit_logs').insert({
            user_id: req.user.id,
            action_type: `AI_ACTION_EXECUTED_${action.type}`,
            payload: action.payload
        });

        res.json({ success: true, result });
    } catch (error) {
        console.error('Action execution error:', error);
        res.status(500).json({ error: { message: error.message || 'Action execution failed' } });
    }
});

module.exports = router;
