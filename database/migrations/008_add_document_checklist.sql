-- Migration: Add document_checklist to university_locks table
-- This enables interactive document tracking with TODO/IN_PROGRESS/DONE statuses
-- AND file upload support for each document

-- Add document_checklist column to university_locks
ALTER TABLE university_locks 
ADD COLUMN IF NOT EXISTS document_checklist JSONB DEFAULT '[]'::jsonb;

-- Add index for faster queries on document checklist
CREATE INDEX IF NOT EXISTS idx_university_locks_document_checklist 
ON university_locks USING gin(document_checklist);

-- Add comment
COMMENT ON COLUMN university_locks.document_checklist IS 'Interactive checklist for required documents with statuses (TODO, IN_PROGRESS, DONE) and file uploads. Structure: [{"name": "...", "status": "...", "fileUrl": "...", "uploadedAt": "..."}]';
