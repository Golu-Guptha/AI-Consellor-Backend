require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
    console.error('❌ Missing Supabase credentials in .env');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function runMigration() {
    console.log('🔄 Running database migration...\n');

    try {
        // Read migration file
        const migrationPath = path.join(__dirname, '../database/migrations/004_add_shortlist_analysis.sql');
        const sql = fs.readFileSync(migrationPath, 'utf8');

        console.log('📝 SQL to execute:\n');
        console.log(sql);
        console.log('\n');

        // Execute via Supabase RPC
        // Note: This requires creating a migration function in Supabase first
        // For now, let's just execute each statement separately

        const statements = [
            `ALTER TABLE user_shortlists ADD COLUMN IF NOT EXISTS ai_analysis JSONB`,
            `ALTER TABLE user_shortlists ADD COLUMN IF NOT EXISTS analyzed_at TIMESTAMP WITH TIME ZONE`,
            `CREATE INDEX IF NOT EXISTS idx_user_shortlists_analyzed_at ON user_shortlists(analyzed_at)`
        ];

        for (const stmt of statements) {
            const { data, error } = await supabase.rpc('exec_sql', { sql_query: stmt });

            if (error) {
                // If exec_sql function doesn't exist, provide manual instructions
                if (error.message.includes('exec_sql')) {
                    console.log('\n⚠️  Direct SQL execution not available via API.');
                    console.log('📋 Please run this SQL manually in your Supabase Dashboard:\n');
                    console.log('Steps:');
                    console.log('1. Go to https://supabase.com/dashboard');
                    console.log('2. Select your project');
                    console.log('3. Go to SQL Editor');
                    console.log('4. Create a new query');
                    console.log('5. Paste and run the following SQL:\n');
                    console.log('```sql');
                    console.log(sql);
                    console.log('```\n');
                    process.exit(0);
                }
                throw error;
            }
        }

        console.log('✅ Migration completed successfully!');
        console.log('   - Added ai_analysis JSONB column');
        console.log('   - Added analyzed_at TIMESTAMP column');
        console.log('   - Created performance index\n');

    } catch (error) {
        console.error('❌ Error:', error.message);

        // Fallback: provide manual instructions
        const migrationPath = path.join(__dirname, '../database/migrations/004_add_shortlist_analysis.sql');
        const sql = fs.readFileSync(migrationPath, 'utf8');

        console.log('\n📋 Please run this SQL manually in Supabase Dashboard:\n');
        console.log('```sql');
        console.log(sql);
        console.log('```\n');
    }
}

runMigration();
