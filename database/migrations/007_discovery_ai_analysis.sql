-- Migration 007: Discovery AI Analysis System
-- Enables personalized university analysis on Discovery page

-- Create user_university_analyses table
CREATE TABLE IF NOT EXISTS user_university_analyses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  university_id UUID REFERENCES universities(id) ON DELETE CASCADE NOT NULL,
  analysis JSONB NOT NULL,
  analyzed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, university_id)
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_user_university_analyses_user ON user_university_analyses(user_id);
CREATE INDEX IF NOT EXISTS idx_user_university_analyses_analyzed_at ON user_university_analyses(analyzed_at);
CREATE INDEX IF NOT EXISTS idx_user_university_analyses_university ON user_university_analyses(university_id);

-- Enable RLS
ALTER TABLE user_university_analyses ENABLE ROW LEVEL SECURITY;

-- Users can read their own analyses
DROP POLICY IF EXISTS "Users can read own analyses" ON user_university_analyses;
CREATE POLICY "Users can read own analyses" 
  ON user_university_analyses FOR SELECT 
  USING (user_id IN (SELECT id FROM users WHERE supabase_user_id = auth.uid()));

-- Service can manage all analyses
DROP POLICY IF EXISTS "Service can manage analyses" ON user_university_analyses;
CREATE POLICY "Service can manage analyses" 
  ON user_university_analyses FOR ALL 
  WITH CHECK (true);
