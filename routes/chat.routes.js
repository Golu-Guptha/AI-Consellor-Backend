const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const supabase = require('../database/supabase');
const { generateAIResponse } = require('../services/aiService');

// Rate limiting
const rateLimit = require('express-rate-limit');
const chatLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 60 // 60 requests per minute
});

// GET /conversations - List all conversations for the user
router.get('/conversations', authMiddleware, chatLimiter, async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('chat_conversations')
            .select('*')
            .eq('user_id', req.user.id)
            .order('updated_at', { ascending: false });

        if (error) throw error;

        res.json({ conversations: data });
    } catch (error) {
        console.error('Error fetching conversations:', error);
        res.status(500).json({ error: { message: 'Failed to fetch conversations' } });
    }
});

// POST /conversations - Create a new conversation
router.post('/conversations', authMiddleware, chatLimiter, async (req, res) => {
    try {
        const { title = 'New Conversation' } = req.body;

        const { data, error } = await supabase
            .from('chat_conversations')
            .insert({
                user_id: req.user.id,
                title: title
            })
            .select()
            .single();

        if (error) throw error;

        res.json({ conversation: data });
    } catch (error) {
        console.error('Error creating conversation:', error);
        res.status(500).json({ error: { message: 'Failed to create conversation' } });
    }
});

// GET /conversations/:id/messages - Get messages for a conversation
router.get('/conversations/:id/messages', authMiddleware, chatLimiter, async (req, res) => {
    try {
        const { id } = req.params;

        // Verify ownership (RLS handles filter, but good for explicit check if needed)
        // Since we have RLS, we can just query directly. If it returns nothing for a valid ID that belongs to someone else, that's fine.
        // But to distinguish "not found" vs "unauthorized", we trust RLS to just return empty or error if we try to access.

        const { data, error } = await supabase
            .from('chat_messages')
            .select('*')
            .eq('conversation_id', id)
            .order('created_at', { ascending: true });

        if (error) throw error;

        res.json({ messages: data });
    } catch (error) {
        console.error('Error fetching messages:', error);
        res.status(500).json({ error: { message: 'Failed to fetch messages' } });
    }
});

// DELETE /conversations/:id - Delete a conversation
router.delete('/conversations/:id', authMiddleware, chatLimiter, async (req, res) => {
    try {
        const { id } = req.params;

        // Delete conversation (cascade will handle messages)
        const { error } = await supabase
            .from('chat_conversations')
            .delete()
            .eq('id', id)
            .eq('user_id', req.user.id);

        if (error) throw error;

        res.json({ success: true, message: 'Conversation deleted' });
    } catch (error) {
        console.error('Error deleting conversation:', error);
        res.status(500).json({ error: { message: 'Failed to delete conversation' } });
    }
});

// PATCH /conversations/:id - Update conversation title
router.patch('/conversations/:id', authMiddleware, chatLimiter, async (req, res) => {
    try {
        const { id } = req.params;
        const { title } = req.body;

        if (!title) {
            return res.status(400).json({ error: { message: 'Title is required' } });
        }

        const { data, error } = await supabase
            .from('chat_conversations')
            .update({ title })
            .eq('id', id)
            .eq('user_id', req.user.id)
            .select()
            .single();

        if (error) throw error;

        res.json({ conversation: data });
    } catch (error) {
        console.error('Error updating conversation:', error);
        res.status(500).json({ error: { message: 'Failed to update conversation' } });
    }
});

module.exports = router;
