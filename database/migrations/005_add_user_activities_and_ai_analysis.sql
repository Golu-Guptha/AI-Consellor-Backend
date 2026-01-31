-- Create user_activities table for tracking user actions
CREATE TABLE IF NOT EXISTS user_activities (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  activity_type VARCHAR(100) NOT NULL,
  entity_id UUID,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create index for performance
CREATE INDEX IF NOT EXISTS idx_user_activities_user_id ON user_activities(user_id);
CREATE INDEX IF NOT EXISTS idx_user_activities_created_at ON user_activities(created_at);

-- Add RLS policies
ALTER TABLE user_activities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own activities" ON user_activities;
CREATE POLICY "Users can read own activities" 
  ON user_activities FOR SELECT 
  USING (user_id IN (SELECT id FROM users WHERE supabase_user_id = auth.uid()));

DROP POLICY IF EXISTS "Service can insert activities" ON user_activities;
CREATE POLICY "Service can insert activities" 
  ON user_activities FOR INSERT 
  WITH CHECK (true);

-- Add AI analysis columns to user_shortlists (if not already exists)
ALTER TABLE user_shortlists 
ADD COLUMN IF NOT EXISTS ai_analysis JSONB,
ADD COLUMN IF NOT EXISTS analyzed_at TIMESTAMP WITH TIME ZONE;

-- Create index for performance
CREATE INDEX IF NOT EXISTS idx_user_shortlists_analyzed_at ON user_shortlists(analyzed_at);
