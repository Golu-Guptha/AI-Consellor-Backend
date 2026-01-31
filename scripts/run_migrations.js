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

console.log('\n🔄 Running Database Migrations...\n');

// Read the migration file
const migrationPath = path.join(__dirname, '../database/migrations/005_add_user_activities_and_ai_analysis.sql');
const sql = fs.readFileSync(migrationPath, 'utf8');

console.log('📋 Please run this SQL in your Supabase Dashboard:\n');
console.log('='.repeat(80));
console.log('Steps:');
console.log('1. Go to https://supabase.com/dashboard');
console.log('2. Select your project');
console.log('3. Click "SQL Editor" in the left sidebar');
console.log('4. Click "New Query"');
console.log('5. Copy and paste the SQL below');
console.log('6. Click "Run" or press Ctrl+Enter');
console.log('='.repeat(80));
console.log('\n```sql');
console.log(sql);
console.log('```\n');
console.log('='.repeat(80));
console.log('\n✅ After running the SQL, your backend will work without errors!\n');
