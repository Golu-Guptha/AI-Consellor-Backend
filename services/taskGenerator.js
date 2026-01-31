const supabase = require('../database/supabase');
const { logActivity } = require('./activityTracker');

/**
 * Sync tasks based on profile status
 * Checks for missing critical items and ensures tasks exist for them
 */
async function syncTasksWithProfile(userId, profile) {
    if (!profile) return;

    const tasksToSync = [];

    // 1. SOP Task
    if (profile.sop_status === 'NOT_STARTED') {
        tasksToSync.push({
            title: 'Draft Statement of Purpose (SOP)',
            description: 'Your SOP is a critical part of your application. Start drafting it now to have enough time for reviews.',
            category: 'DOCUMENT'
        });
    }

    // 2. English Proficiency Task
    if (!profile.ielts_score && !profile.toefl_score) {
        tasksToSync.push({
            title: 'Take English Proficiency Test',
            description: 'You need an IELTS or TOEFL score for most international universities. Book a test date.',
            category: 'TEST'
        });
    }

    // 3. GRE/GMAT Task (if applicable)
    if ((profile.target_degree === 'Masters' || profile.target_degree === 'PhD') && !profile.gre_score) {
        tasksToSync.push({
            title: 'Take GRE Exam',
            description: 'Many graduate programs require or recommend a GRE score. Check your target universities.',
            category: 'TEST'
        });
    } else if (profile.target_degree === 'MBA' && !profile.gmat_score) {
        tasksToSync.push({
            title: 'Take GMAT Exam',
            description: 'MBA programs often require a GMAT score.',
            category: 'TEST'
        });
    }

    // 4. Budget Task
    if (!profile.budget_max || !profile.funding_plan) {
        tasksToSync.push({
            title: 'Finalize Budget & Funding Plan',
            description: 'Determine your maximum budget and how you plan to fund your studies (Loan, Savings, etc.).',
            category: 'FINANCE'
        });
    }

    // Process tasks
    for (const taskDef of tasksToSync) {
        await ensureTaskExists(userId, taskDef);
    }
}

/**
 * Ensure a specific task exists for the user (by title)
 * If not, create it.
 */
async function ensureTaskExists(userId, taskDef) {
    try {
        // Check if task exists (active or completed)
        const { data: existing } = await supabase
            .from('tasks')
            .select('id')
            .eq('user_id', userId)
            .ilike('title', taskDef.title)
            .maybeSingle();

        if (!existing) {
            console.log(`✨ Creating suggested task for user ${userId}: ${taskDef.title}`);

            // Create task due in 2 weeks by default
            const dueDate = new Date();
            dueDate.setDate(dueDate.getDate() + 14);

            const { data: newTask, error } = await supabase
                .from('tasks')
                .insert({
                    user_id: userId,
                    title: taskDef.title,
                    description: taskDef.description,
                    status: 'TODO',
                    created_by: 'AI_TRIGGER',
                    due_date: dueDate.toISOString() // Basic default
                })
                .select()
                .single();

            if (error) throw error;

            // Log activity
            if (newTask) {
                await logActivity(userId, 'TASK_CREATE', newTask.id, {
                    task_title: newTask.title,
                    source: 'PROFILE_SYNC'
                });
            }
        }
    } catch (error) {
        console.error(`Failed to ensure task "${taskDef.title}":`, error.message);
    }
}

module.exports = { syncTasksWithProfile };
