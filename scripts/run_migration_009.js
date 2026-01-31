const fs = require('fs');
const path = require('path');
const supabase = require('../database/supabase');

async function runMigration() {
    try {
        const sqlPath = path.join(__dirname, '../database/migrations/009_create_chat_tables.sql');
        const sql = fs.readFileSync(sqlPath, 'utf8');

        console.log('Running migration 009: Create chat tables...');

        // Try RPC if available (exec_sql is a common helper function)
        // If not available, we can't run DDL via JS client without it or direct DB access
        const { error } = await supabase.rpc('exec_sql', { sql });

        if (error) {
            console.error('RPC Migration failed (expected if exec_sql function missing):', error.message);
            console.log('\n⚠️  AUTOMATED MIGRATION FAILED. PLEASE RUN MANUALLY.\n');
            console.log('--- COPY AND PASTE THE FOLLOWING SQL IN SUPABASE DASHBOARD ---');
            console.log(sql);
            console.log('----------------------------------------------------------\n');
        } else {
            console.log('✅ Migration 009 successful via RPC!');
        }

    } catch (err) {
        console.error('Migration script error:', err);
    }
}

runMigration();
