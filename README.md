# AI Counsellor Backend

The Node.js/Express backend for the AI Study Abroad Counsellor application.

## Features
- **AI Integration**: Orchestrates Google Gemini API for chat, profile analysis, and document generation.
- **University Data**: Manages university database and enrichment.
- **Lock System**: Handles university locking and application tracking.
- **Activity Tracking**: Logs user actions for AI context awareness.
- **Database**: PostgreSQL integration via Supabase.

## Tech Stack
- **Runtime**: Node.js
- **Framework**: Express.js
- **Database**: Supabase (PostgreSQL)
- **AI**: Google Gemini (gemini-2.5-flash)
- **Authentication**: Supabase Auth

## Getting Started

### Prerequisites
- Node.js (v18+)
- Supabase Project
- Google Gemini API Key

### Installation
1. Install dependencies
   ```original
   npm install
   ```
2. Create `.env` file
   ```original
   PORT=3001
   SUPABASE_URL=your_supabase_url
   SUPABASE_SERVICE_ROLE_KEY=your_service_key
   GOOGLE_GEMINI_API_KEY=your_gemini_key
   FRONTEND_URL=http://localhost:5173
   ```
3. Run migrations (see `scripts/`)
4. Start server
   ```original
   npm run dev
   ```

## Deployment
This project is configured for deployment on **Render**.
See `deployment_plan.md` for details.
