-- Add application_guidance column to university_locks table
ALTER TABLE university_locks 
ADD COLUMN IF NOT EXISTS application_guidance JSONB DEFAULT '{}';

-- Create index for performance on JSONB operations if needed (optional but good practice)
-- CREATE INDEX IF NOT EXISTS idx_university_locks_guidance ON university_locks USING gin (application_guidance);
