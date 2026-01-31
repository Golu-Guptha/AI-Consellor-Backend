-- Add AI analysis columns to user_shortlists table
ALTER TABLE user_shortlists 
ADD COLUMN IF NOT EXISTS ai_analysis JSONB,
ADD COLUMN IF NOT EXISTS analyzed_at TIMESTAMP WITH TIME ZONE;

-- Create index for performance
CREATE INDEX IF NOT EXISTS idx_user_shortlists_analyzed_at ON user_shortlists(analyzed_at);
