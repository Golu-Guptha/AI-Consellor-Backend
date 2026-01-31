-- AI Counsellor Database Schema
-- Run this in Supabase SQL Editor

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Users table (linked to Supabase Auth)
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email VARCHAR(255) UNIQUE NOT NULL,
  supabase_user_id UUID UNIQUE NOT NULL,
  name VARCHAR(255),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Profiles table
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  
  -- Academic Background
  education_level VARCHAR(50) CHECK (education_level IN ('HS', 'Bachelors', 'Masters', 'MBA', 'PhD')),
  degree_major VARCHAR(255),
  grad_year INTEGER,
  gpa DECIMAL(4, 2), -- e.g., 3.75
  
  -- Goals
  target_degree VARCHAR(50) CHECK (target_degree IN ('Bachelors', 'Masters', 'MBA', 'PhD')),
  field_of_study VARCHAR(255),
  intake_year INTEGER,
  preferred_countries JSONB DEFAULT '[]', -- array of country codes
  
  -- Budget
  budget_min INTEGER, -- USD per year
  budget_max INTEGER, -- USD per year
  funding_plan VARCHAR(50) CHECK (funding_plan IN ('Self-Funded', 'Scholarship', 'Loan', 'Mixed')),
  
  -- Test Scores
  ielts_score DECIMAL(3, 1), -- e.g., 7.5
  toefl_score INTEGER,       -- e.g., 105
  gre_score INTEGER,          -- e.g., 325
  gmat_score INTEGER,         -- e.g., 720
  
  -- SOP & Readiness
  sop_status VARCHAR(50) CHECK (sop_status IN ('NOT_STARTED', 'DRAFT', 'READY')) DEFAULT 'NOT_STARTED',
  
  -- Metadata
  profile_complete BOOLEAN DEFAULT FALSE,
  last_updated_by_ai BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  UNIQUE(user_id)
);

-- 3. Universities table (cached data from external APIs)
CREATE TABLE IF NOT EXISTS universities (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  external_id VARCHAR(255) UNIQUE, -- from source API
  name VARCHAR(500) NOT NULL,
  country VARCHAR(100) NOT NULL,
  domain VARCHAR(255),
  city VARCHAR(255),
  data_source VARCHAR(50) CHECK (data_source IN ('HIPOLABS', 'COLLEGE_SCORECARD', 'OTHER')),
  
  -- Metrics (nullable as not all sources provide this)
  tuition_estimate INTEGER, -- USD per year
  acceptance_rate DECIMAL(5, 2), -- percentage
  rank INTEGER,
  
  -- Cache metadata
  cached_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 4. User Shortlists table
CREATE TABLE IF NOT EXISTS user_shortlists (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  university_id UUID REFERENCES universities(id) ON DELETE CASCADE NOT NULL,
  category VARCHAR(50) CHECK (category IN ('DREAM', 'TARGET', 'SAFE')) DEFAULT 'TARGET',
  added_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  UNIQUE(user_id, university_id)
);

-- 5. University Locks table
CREATE TABLE IF NOT EXISTS university_locks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  university_id UUID REFERENCES universities(id) ON DELETE CASCADE NOT NULL,
  locked_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  unlocked_at TIMESTAMP WITH TIME ZONE,
  lock_reason_text TEXT,
  
  UNIQUE(user_id, university_id)
);

-- 6. Tasks table
CREATE TABLE IF NOT EXISTS tasks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  title VARCHAR(500) NOT NULL,
  description TEXT,
  due_date DATE,
  status VARCHAR(50) CHECK (status IN ('TODO', 'IN_PROGRESS', 'DONE')) DEFAULT 'TODO',
  related_university_id UUID REFERENCES universities(id) ON DELETE SET NULL,
  created_by VARCHAR(50) CHECK (created_by IN ('AI', 'HUMAN')) DEFAULT 'HUMAN',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 7. Audit Logs table
CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  action_type VARCHAR(100) NOT NULL, -- e.g., 'SUGGEST_SHORTLIST', 'CREATE_TASK', 'LOCK_UNIVERSITY'
  payload JSONB DEFAULT '{}',
  timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 8. User Activities table (for AI awareness)
CREATE TABLE IF NOT EXISTS user_activities (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  activity_type VARCHAR(100) NOT NULL, -- 'SHORTLIST_ADD', 'LOCK_UNIVERSITY', 'TASK_COMPLETE', 'SEARCH_UNIVERSITY', etc.
  entity_id UUID, -- Related university/task ID
  metadata JSONB DEFAULT '{}', -- Extra context (university_name, task_title, etc.)
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX idx_profiles_user_id ON profiles(user_id);
CREATE INDEX idx_profiles_complete ON profiles(profile_complete);
CREATE INDEX idx_universities_country ON universities(country);
CREATE INDEX idx_universities_cached_at ON universities(cached_at);
CREATE INDEX idx_shortlists_user_id ON user_shortlists(user_id);
CREATE INDEX idx_locks_user_id ON university_locks(user_id);
CREATE INDEX idx_locks_active ON university_locks(user_id, unlocked_at) WHERE unlocked_at IS NULL;
CREATE INDEX idx_tasks_user_id ON tasks(user_id);
CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_timestamp ON audit_logs(timestamp);
CREATE INDEX idx_activities_user_id ON user_activities(user_id);
CREATE INDEX idx_activities_created_at ON user_activities(created_at);
CREATE INDEX idx_activities_type ON user_activities(activity_type);

-- Updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply updated_at triggers
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_universities_updated_at BEFORE UPDATE ON universities FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_tasks_updated_at BEFORE UPDATE ON tasks FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Row Level Security (RLS) Policies
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_shortlists ENABLE ROW LEVEL SECURITY;
ALTER TABLE university_locks ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE universities ENABLE ROW LEVEL SECURITY;

-- Users can read their own data
CREATE POLICY "Users can read own data" ON users FOR SELECT USING (auth.uid() = supabase_user_id);
CREATE POLICY "Users can update own data" ON users FOR UPDATE USING (auth.uid() = supabase_user_id);

-- Profiles policies
CREATE POLICY "Users can read own profile" ON profiles FOR SELECT USING (user_id IN (SELECT id FROM users WHERE supabase_user_id = auth.uid()));
CREATE POLICY "Users can insert own profile" ON profiles FOR INSERT WITH CHECK (user_id IN (SELECT id FROM users WHERE supabase_user_id = auth.uid()));
CREATE POLICY "Users can update own profile" ON profiles FOR UPDATE USING (user_id IN (SELECT id FROM users WHERE supabase_user_id = auth.uid()));

-- Shortlists policies
CREATE POLICY "Users can read own shortlists" ON user_shortlists FOR SELECT USING (user_id IN (SELECT id FROM users WHERE supabase_user_id = auth.uid()));
CREATE POLICY "Users can manage own shortlists" ON user_shortlists FOR ALL USING (user_id IN (SELECT id FROM users WHERE supabase_user_id = auth.uid()));

-- Locks policies
CREATE POLICY "Users can read own locks" ON university_locks FOR SELECT USING (user_id IN (SELECT id FROM users WHERE supabase_user_id = auth.uid()));
CREATE POLICY "Users can manage own locks" ON university_locks FOR ALL USING (user_id IN (SELECT id FROM users WHERE supabase_user_id = auth.uid()));

-- Tasks policies
CREATE POLICY "Users can read own tasks" ON tasks FOR SELECT USING (user_id IN (SELECT id FROM users WHERE supabase_user_id = auth.uid()));
CREATE POLICY "Users can manage own tasks" ON tasks FOR ALL USING (user_id IN (SELECT id FROM users WHERE supabase_user_id = auth.uid()));

-- Audit logs policies
CREATE POLICY "Users can read own audit logs" ON audit_logs FOR SELECT USING (user_id IN (SELECT id FROM users WHERE supabase_user_id = auth.uid()));
CREATE POLICY "Service can insert audit logs" ON audit_logs FOR INSERT WITH CHECK (true);

-- User activities policies
CREATE POLICY "Users can read own activities" ON user_activities FOR SELECT USING (user_id IN (SELECT id FROM users WHERE supabase_user_id = auth.uid()));
CREATE POLICY "Service can insert activities" ON user_activities FOR INSERT WITH CHECK (true);

-- Universities are public read
CREATE POLICY "Anyone can read universities" ON universities FOR SELECT USING (true);
CREATE POLICY "Service can manage universities" ON universities FOR ALL USING (true);
