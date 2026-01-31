const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const supabase = require('../database/supabase');
const { logActivity } = require('../services/activityTracker');

// Get user tasks
router.get('/', authMiddleware, async (req, res) => {
    try {
        const { status, university_id } = req.query;

        let query = supabase
            .from('tasks')
            .select(`
        *,
        university:universities(id, name, country)
      `)
            .eq('user_id', req.user.id)
            .order('due_date', { ascending: true, nullsFirst: false });

        if (status) {
            query = query.eq('status', status);
        }

        if (university_id) {
            query = query.eq('related_university_id', university_id);
        }

        const { data, error } = await query;

        if (error) throw error;

        res.json({ tasks: data || [] });
    } catch (error) {
        console.error('Get tasks error:', error);
        res.status(500).json({ error: { message: 'Failed to fetch tasks' } });
    }
});

// Create task
router.post('/', authMiddleware, async (req, res) => {
    try {
        const { title, description, due_date, related_university_id } = req.body;

        if (!title) {
            return res.status(400).json({ error: { message: 'Title is required' } });
        }

        const { data, error } = await supabase
            .from('tasks')
            .insert({
                user_id: req.user.id,
                title,
                description: description || null,
                due_date: due_date || null,
                related_university_id: related_university_id || null,
                created_by: 'HUMAN'
            })
            .select()
            .single();

        if (error) throw error;

        // Log activity
        await logActivity(req.user.id, 'TASK_CREATE', data.id, {
            task_title: data.title,
            due_date: data.due_date
        });

        res.json({ task: data });
    } catch (error) {
        console.error('Create task error:', error);
        res.status(500).json({ error: { message: 'Failed to create task' } });
    }
});

// Update task
router.patch('/:id', authMiddleware, async (req, res) => {
    try {
        const updates = req.body;
        const allowedFields = ['title', 'description', 'due_date', 'status'];

        const filteredUpdates = Object.keys(updates)
            .filter(key => allowedFields.includes(key))
            .reduce((obj, key) => {
                obj[key] = updates[key];
                return obj;
            }, {});

        if (Object.keys(filteredUpdates).length === 0) {
            return res.status(400).json({ error: { message: 'No valid fields to update' } });
        }

        const { data, error } = await supabase
            .from('tasks')
            .update(filteredUpdates)
            .eq('id', req.params.id)
            .eq('user_id', req.user.id)
            .select()
            .single();

        if (error) throw error;

        // Log activity if task was completed
        if (filteredUpdates.status === 'DONE' && updates.status === 'DONE') {
            await logActivity(req.user.id, 'TASK_COMPLETE', req.params.id, {
                task_title: data.title
            });
        } else if (filteredUpdates.status) {
            await logActivity(req.user.id, 'TASK_UPDATE', req.params.id, {
                task_title: data.title,
                new_status: data.status
            });
        }

        res.json({ task: data });
    } catch (error) {
        console.error('Update task error:', error);
        res.status(500).json({ error: { message: 'Failed to update task' } });
    }
});

// Delete task
router.delete('/:id', authMiddleware, async (req, res) => {
    try {
        const { error } = await supabase
            .from('tasks')
            .delete()
            .eq('id', req.params.id)
            .eq('user_id', req.user.id);

        if (error) throw error;

        res.json({ message: 'Task deleted successfully' });
    } catch (error) {
        console.error('Delete task error:', error);
        res.status(500).json({ error: { message: 'Failed to delete task' } });
    }
});

module.exports = router;
