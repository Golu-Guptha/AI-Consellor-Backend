require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
    console.error('❌ Missing Supabase credentials in .env');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function runMigration() {
    console.log('🔄 Applying migration 006...');

    // SQL to add column
    const sql = `ALTER TABLE university_locks 
                 ADD COLUMN IF NOT EXISTS application_guidance JSONB DEFAULT '{}';`;

    // Try RPC first
    const { error } = await supabase.rpc('exec_sql', { sql_query: sql });

    if (error) {
        console.error('❌ RPC Failed:', error.message);

        // If RPC fails, we can't do much with supabase-js client alone directly on schema 
        // unless we have direct PG access, which `pg` library supports if we have the connection string.
        // Let's check if we have DATABASE_URL in env, otherwise just print instructions.

        if (process.env.DATABASE_URL) {
            console.log('🔄 Attempting direct connection via pg...');
            const { Client } = require('pg');
            const client = new Client({ connectionString: process.env.DATABASE_URL });
            try {
                await client.connect();
                await client.query(sql);
                await client.end();
                console.log('✅ Migration applied via pg client!');
                return;
            } catch (pgError) {
                console.error('❌ Postgres Client Failed:', pgError.message);
            }
        }

        console.log('\n⚠️  ACTION REQUIRED: Please run this SQL in your Supabase Dashboard:');
        console.log('---------------------------------------------------------------------');
        console.log(sql);
        console.log('---------------------------------------------------------------------');
    } else {
        console.log('✅ Migration applied successfully via RPC!');
    }
}

runMigration();
