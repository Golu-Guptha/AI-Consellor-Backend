require('dotenv').config();
const fs = require('fs');
const path = require('path');

console.log('\n🔧 Discovery Page AI Analysis - Database Migration\n');

// Read the migration file
const migrationPath = path.join(__dirname, '../database/migrations/007_discovery_ai_analysis.sql');
const sql = fs.readFileSync(migrationPath, 'utf8');

console.log('📋 Run this SQL in your Supabase Dashboard:\n');
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
console.log('\n✅ This will create the user_university_analyses table for Discovery AI caching.\n');
