const fs = require('fs');
const path = require('path');
const supabase = require('../database/supabase');

async function runMigration() {
    try {
        const sqlPath = path.join(__dirname, '../database/migrations/008_add_document_checklist.sql');
        const sql = fs.readFileSync(sqlPath, 'utf8');

        console.log('Running migration 008: Add document_checklist...');

        // Try RPC if available
        const { error } = await supabase.rpc('exec_sql', { sql });

        if (error) {
            console.error('RPC Migration failed (expected if exec_sql function missing):', error);
            console.log('--- PLEASE RUN THE FOLLOWING SQL IN SUPABASE DASHBOARD ---');
            console.log(sql);
            console.log('----------------------------------------------------------');
        } else {
            console.log('Migration 008 successful via RPC!');
        }

    } catch (err) {
        console.error('Migration script error:', err);
    }
}

runMigration();
