-- Add verification fields to universities table
ALTER TABLE universities 
ADD COLUMN IF NOT EXISTS verified BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS added_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS verification_notes TEXT;

-- Update the check constraint for data_source to include 'MANUAL'
ALTER TABLE universities DROP CONSTRAINT IF EXISTS universities_data_source_check;
ALTER TABLE universities ADD CONSTRAINT universities_data_source_check 
  CHECK (data_source IN ('HIPOLABS', 'COLLEGE_SCORECARD', 'OTHER', 'MANUAL'));
