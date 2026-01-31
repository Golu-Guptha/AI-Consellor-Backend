-- Consolidated Migration Script for AI Features (FIXED POLICY CONFLICTS)
-- Run this ENTIRE script in Supabase SQL Editor to fix all missing tables

-- 1. Create enrichment_cache table (for AI auto-fill)
CREATE TABLE IF NOT EXISTS enrichment_cache (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  university_name VARCHAR(255) NOT NULL,
  country VARCHAR(255) NOT NULL,
  enriched_data JSONB NOT NULL,
  confidence_score DECIMAL(3, 2) DEFAULT 0.0,
  source VARCHAR(50) DEFAULT 'AI',
  is_verified BOOLEAN DEFAULT FALSE,
  access_count INTEGER DEFAULT 1,
  last_accessed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(university_name, country)
);

CREATE INDEX IF NOT EXISTS idx_enrichment_cache_lookup ON enrichment_cache(university_name, country);

ALTER TABLE enrichment_cache ENABLE ROW LEVEL SECURITY;

-- Drop existing policies first to prevent 42710 error
DROP POLICY IF EXISTS "Public read access" ON enrichment_cache;
CREATE POLICY "Public read access" ON enrichment_cache FOR SELECT USING (true);

DROP POLICY IF EXISTS "Service insert access" ON enrichment_cache;
CREATE POLICY "Service insert access" ON enrichment_cache FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Service update access" ON enrichment_cache;
CREATE POLICY "Service update access" ON enrichment_cache FOR UPDATE USING (true);


-- 2. Create user_activities table (for AI context & logging)
CREATE TABLE IF NOT EXISTS user_activities (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  activity_type VARCHAR(100) NOT NULL,
  entity_id UUID,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_activities_user_id ON user_activities(user_id);
CREATE INDEX IF NOT EXISTS idx_user_activities_created_at ON user_activities(created_at);

ALTER TABLE user_activities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own activities" ON user_activities;
CREATE POLICY "Users can read own activities" 
  ON user_activities FOR SELECT 
  USING (user_id IN (SELECT id FROM users WHERE supabase_user_id = auth.uid()));

DROP POLICY IF EXISTS "Service can insert activities" ON user_activities;
CREATE POLICY "Service can insert activities" 
  ON user_activities FOR INSERT 
  WITH CHECK (true);


-- 3. Add AI analysis columns to user_shortlists (for Profile Fit & Risks)
ALTER TABLE user_shortlists 
ADD COLUMN IF NOT EXISTS ai_analysis JSONB,
ADD COLUMN IF NOT EXISTS analyzed_at TIMESTAMP WITH TIME ZONE;

CREATE INDEX IF NOT EXISTS idx_user_shortlists_analyzed_at ON user_shortlists(analyzed_at);
