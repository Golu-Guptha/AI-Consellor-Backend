-- Chat History Database Schema
-- Run this in Supabase SQL Editor

-- 1. Create chat_conversations table
CREATE TABLE IF NOT EXISTS chat_conversations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
    title VARCHAR(500) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Create chat_messages table
CREATE TABLE IF NOT EXISTS chat_messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    conversation_id UUID REFERENCES chat_conversations(id) ON DELETE CASCADE NOT NULL,
    role VARCHAR(50) CHECK (role IN ('user', 'assistant')) NOT NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_chat_conversations_user_id ON chat_conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_chat_conversations_updated_at ON chat_conversations(updated_at);
CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation_id ON chat_messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_created_at ON chat_messages(created_at);

-- Apply updated_at triggers
DROP TRIGGER IF EXISTS update_chat_conversations_updated_at ON chat_conversations;
CREATE TRIGGER update_chat_conversations_updated_at 
BEFORE UPDATE ON chat_conversations 
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Row Level Security (RLS) Policies
ALTER TABLE chat_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;

-- Conversations policies
DROP POLICY IF EXISTS "Users can read own conversations" ON chat_conversations;
CREATE POLICY "Users can read own conversations" 
ON chat_conversations FOR SELECT 
USING (user_id IN (SELECT id FROM users WHERE supabase_user_id = auth.uid()));

DROP POLICY IF EXISTS "Users can insert own conversations" ON chat_conversations;
CREATE POLICY "Users can insert own conversations" 
ON chat_conversations FOR INSERT 
WITH CHECK (user_id IN (SELECT id FROM users WHERE supabase_user_id = auth.uid()));

DROP POLICY IF EXISTS "Users can update own conversations" ON chat_conversations;
CREATE POLICY "Users can update own conversations" 
ON chat_conversations FOR UPDATE 
USING (user_id IN (SELECT id FROM users WHERE supabase_user_id = auth.uid()));

DROP POLICY IF EXISTS "Users can delete own conversations" ON chat_conversations;
CREATE POLICY "Users can delete own conversations" 
ON chat_conversations FOR DELETE 
USING (user_id IN (SELECT id FROM users WHERE supabase_user_id = auth.uid()));

-- Messages policies
-- Users can read messages if they own the conversation
DROP POLICY IF EXISTS "Users can read own messages" ON chat_messages;
CREATE POLICY "Users can read own messages" 
ON chat_messages FOR SELECT 
USING (conversation_id IN (
    SELECT id FROM chat_conversations 
    WHERE user_id IN (SELECT id FROM users WHERE supabase_user_id = auth.uid())
));

-- Users can insert messages if they own the conversation
DROP POLICY IF EXISTS "Users can insert own messages" ON chat_messages;
CREATE POLICY "Users can insert own messages" 
ON chat_messages FOR INSERT 
WITH CHECK (conversation_id IN (
    SELECT id FROM chat_conversations 
    WHERE user_id IN (SELECT id FROM users WHERE supabase_user_id = auth.uid())
));

-- Service policies (if needed for background tasks, though specific policies above should cover it)
-- Note: Service role always bypasses RLS, but if we use a specific app user for the backend, 
-- we might need additional policies. For now, we assume backend uses the authenticated user context or service role.
