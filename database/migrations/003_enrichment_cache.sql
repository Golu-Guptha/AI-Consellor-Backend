-- Create enrichment cache table for AI-enriched university data
CREATE TABLE IF NOT EXISTS enrichment_cache (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    university_name VARCHAR(500) NOT NULL,
    country VARCHAR(100) NOT NULL,
    enriched_data JSONB NOT NULL,
    confidence_score DECIMAL(3, 2) DEFAULT 0.75, -- 0.00 to 1.00
    source VARCHAR(50) DEFAULT 'AI', -- 'GEMINI', 'LLAMA', 'MANUAL', 'VERIFIED'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_accessed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    access_count INTEGER DEFAULT 1,
    is_verified BOOLEAN DEFAULT FALSE,
    verified_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    verified_at TIMESTAMP WITH TIME ZONE,
    
    UNIQUE(university_name, country)
);

-- Indexes for performance
CREATE INDEX idx_enrichment_cache_lookup ON enrichment_cache(university_name, country);
CREATE INDEX idx_enrichment_cache_created ON enrichment_cache(created_at);
CREATE INDEX idx_enrichment_cache_accessed ON enrichment_cache(last_accessed_at);
CREATE INDEX idx_enrichment_cache_verified ON enrichment_cache(is_verified);

-- Trigger to update last_accessed_at automatically
CREATE OR REPLACE FUNCTION update_cache_access()
RETURNS TRIGGER AS $$
BEGIN
    NEW.last_accessed_at = NOW();
    NEW.access_count = OLD.access_count + 1;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Note: We'll manually update access in the application for better control
-- CREATE TRIGGER trigger_update_cache_access
-- BEFORE UPDATE ON enrichment_cache
-- FOR EACH ROW
-- EXECUTE FUNCTION update_cache_access();
