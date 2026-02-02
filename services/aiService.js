const axios = require('axios');
const { GoogleGenAI } = require('@google/genai');

// Initialize API keys
// Initialize API keys (Support multiple keys for rotation)
const getKeys = (envVar) => {
    return (process.env[envVar] || '').split(',').map(k => k.trim()).filter(k => k.length > 0);
};

const GEMINI_API_KEYS = getKeys('GEMINI_API_KEYS');
const GROQ_API_KEYS = getKeys('GROQ_API_KEYS');

/**
 * Call Gemini 1.5 Flash (Primary - Stable SDK)
 * Using @google/generative-ai
 */
async function callGemini(messages, systemPrompt, preferredModel = 'gemini-2.5-flash') {
    if (!GEMINI_API_KEYS || GEMINI_API_KEYS.length === 0) {
        throw new Error('GEMINI_API_KEYS not configured');
    }

    const fallbackModel = preferredModel === 'gemini-2.5-flash' ? 'gemini-2.5-flash-lite' : 'gemini-2.5-flash';
    const modelsToTry = [preferredModel, fallbackModel];

    let lastError = null;

    // We'll try user's preferred model first with all keys, then fallback model with all keys
    for (const modelName of modelsToTry) {
        console.log(`🤖 Trying Gemini Model: ${modelName}`);

        // Shuffle keys for load balancing
        const shuffledKeys = [...GEMINI_API_KEYS].sort(() => 0.5 - Math.random());

        for (const apiKey of shuffledKeys) {
            try {
                const { GoogleGenerativeAI } = require('@google/generative-ai');
                const genAI = new GoogleGenerativeAI(apiKey);
                const model = genAI.getGenerativeModel({
                    model: modelName,
                    generationConfig: { responseMimeType: 'application/json' }
                });

                // Combine system prompt and user messages
                const fullPrompt = `${systemPrompt}\n\nUser: ${messages.map(m => m.content).join('\n')}`;

                const result = await model.generateContent(fullPrompt);
                const response = await result.response;
                const text = response.text();

                // Check for empty response
                if (!text) throw new Error('Empty response from Gemini');

                // Parse JSON response if it looks like JSON
                try {
                    // Remove markdown code blocks if present
                    const cleanedText = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

                    // Fallback to JSON object matching
                    const objectMatch = cleanedText.match(/\{[\s\S]*\}/);
                    if (objectMatch) {
                        const json = JSON.parse(objectMatch[0]);
                        return { ...json, _aiSource: 'GEMINI', _model: modelName };
                    }
                } catch (parseError) {
                    console.warn('Failed to parse JSON, returning text only');
                }

                // Success! Return the response
                return { text: text, actions: [], _aiSource: 'GEMINI', _model: modelName };

            } catch (error) {
                console.warn(`⚠️ Gemini (${modelName}) Key ${apiKey.substring(0, 8)}... failed: ${error.message}`);
                lastError = error;
                // Continue to next key
            }
        }
    }

    // If we get here, all keys AND all models failed
    console.error('❌ All Gemini keys and models failed');
    throw lastError;
}

/**
 * Call Groq Llama 3.3 (Fallback)
 */
async function callGroq(messages, systemPrompt) {
    if (!GROQ_API_KEYS || GROQ_API_KEYS.length === 0) {
        throw new Error('GROQ_API_KEYS not configured');
    }

    let lastError = null;
    const shuffledKeys = [...GROQ_API_KEYS].sort(() => 0.5 - Math.random());

    for (const apiKey of shuffledKeys) {
        try {
            const response = await axios.post(
                'https://api.groq.com/openai/v1/chat/completions',
                {
                    model: 'llama-3.3-70b-versatile',
                    messages: [
                        { role: 'system', content: systemPrompt },
                        ...messages
                    ],
                    temperature: 0.7,
                    max_tokens: 2000
                },
                {
                    headers: {
                        'Authorization': `Bearer ${apiKey}`,
                        'Content-Type': 'application/json'
                    }
                }
            );

            const text = response.data.choices[0].message.content;

            // Parse JSON response with robust cleanup (same as Gemini)
            try {
                // Remove markdown code blocks if present
                const cleanedText = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

                // Fallback to JSON object matching
                const objectMatch = cleanedText.match(/\{[\s\S]*\}/);
                if (objectMatch) {
                    const json = JSON.parse(objectMatch[0]);
                    // Ensure text property exists
                    if (!json.text && json.actions) {
                        json.text = "I've updated your profile.";
                    } else if (!json.text) {
                        json.text = "I heard you.";
                    }
                    return { ...json, _aiSource: 'LLAMA' };
                }
            } catch (parseError) {
                console.warn('Groq JSON parse failed, returning text only');
            }

            return { text: text, actions: [], _aiSource: 'LLAMA' };

        } catch (error) {
            console.warn(`⚠️ Groq Key ${apiKey.substring(0, 8)}... failed: ${error.message}`);
            lastError = error;
            // Continue to next key
        }
    }

    // If we get here, all keys failed
    console.error('❌ All Groq keys failed');
    throw lastError;
}

/**
 * Main AI reasoning function
 * Supports toggling between Gemini and Groq as primary
 */
async function getLLMResponse(messages, systemPrompt, options = { provider: 'GROQ', model: 'gemini-2.5-flash' }) {
    // Handle legacy string argument if passed
    const provider = typeof options === 'string' ? options : (options.provider || 'GROQ');
    const preferredModel = typeof options === 'object' ? options.model : 'gemini-2.5-flash';

    const tryGemini = async () => {
        return await callGemini(messages, systemPrompt, preferredModel);
    };

    const tryGroq = async () => {
        console.log('🚀 Calling Groq Llama 3.3...');
        return await callGroq(messages, systemPrompt);
    };

    if (provider === 'GEMINI') {
        try {
            return await tryGemini();
        } catch (geminiError) {
            console.warn('⚠️ Gemini failed (all keys/models), falling back to Groq:', geminiError.message);
            try {
                return await tryGroq();
            } catch (groqError) {
                console.error('❌ Both AI services failed (Gemini Primary)');
                return {
                    text: "I'm having trouble connecting to my AI services. Please check your connection.",
                    error: true
                };
            }
        }
    } else {
        // Default to GROQ as primary
        try {
            return await tryGroq();
        } catch (groqError) {
            console.warn('⚠️ Groq failed, falling back to Gemini:', groqError.message);
            try {
                return await tryGemini();
            } catch (geminiError) {
                console.error('❌ Both AI services failed (Groq Primary)');
                return {
                    text: "I'm having trouble connecting to my AI services. Please check your connection.",
                    error: true
                };
            }
        }
    }
}

/**
 * Generate AI counsellor response with full context awareness
 */
async function generateAIResponse({ userQuery, userId, mode = 'COUNSELLOR', currentFormData = {} }) {
    // Build comprehensive context
    const { buildUserContext, analyzeProfileStrength } = require('./aiContext');
    const userContext = await buildUserContext(userId);

    // Format activities for prompt
    const formatActivity = (a) => {
        const time = new Date(a.created_at);
        const hoursAgo = Math.floor((Date.now() - time) / (1000 * 60 * 60));
        const timeStr = hoursAgo < 24 ? `${hoursAgo}h ago` : `${Math.floor(hoursAgo / 24)}d ago`;
        return `- ${a.activity_type}: ${a.metadata?.university_name || a.metadata?.task_title || 'N/A'} (${timeStr})`;
    };

    // Extract user's preferred countries
    const preferredCountries = userContext.profile.preferred_countries || [];

    // Stage descriptions
    const stageGuidance = {
        1: "Focus on completing your profile: add test scores, GPA, and goals",
        2: "Explore universities and build your shortlist (aim for 8-12 schools)",
        3: "Finalize your shortlist and lock universities to apply to",
        4: "Complete application tasks: SOP, LORs, documents",
        5: "All done! Submit applications and await results"
    };

    let systemPrompt = '';

    if (mode === 'ONBOARDING') {
        systemPrompt = `You are a STRICT Onboarding Assistant. 
Your ONLY goal is to fill the user's profile JSON by asking questions sequentially.

## CURRENT PROFILE STATE:
${JSON.stringify(currentFormData, null, 2)}

## THE CHECKLIST (Strict Order):
1. **Academic**: Needs 'education_level' AND 'degree_major' (and optional 'gpa').
2. **Goals**: Needs 'target_degree' AND 'field_of_study' AND 'preferred_countries'.
3. **Budget**: Needs 'budget_max'.
4. **Funding**: Needs 'funding_plan'.
5. **Tests**: Needs 'ielts_score' OR 'gre_score' (or confirmation of "None").
6. **SOP**: Needs 'sop_status' ("NOT_STARTED", "DRAFT", "READY").

## YOUR ALGORITHM:

**STEP 1: ANALYZE INPUT**
- Did the user provide new info? -> **GENERATE "UPDATE_ONBOARDING_STATE" ACTION**.
- Example: "Computer Science" -> Action: { "degree_major": "Computer Science" }
- Example: "Ready" (for SOP) -> Action: { "sop_status": "READY" }

**STEP 2: DETERMINE NEXT QUESTION (First Missing Item)**
- Is 'education_level' missing? -> Ask "What is your current education level?"
- Is 'degree_major' missing? -> Ask "What is your major?"
- Is 'target_degree' missing? -> Ask "What degree are you planning to pursue?"
- Is 'field_of_study' missing? -> Ask "What field do you want to study?"
- Is 'preferred_countries' empty? -> Ask "Which countries are you targeting?"
- Is 'budget_max' missing? -> Ask "What is your maximum budget?"
- Is 'funding_plan' missing? -> Ask "How will you fund this (Loan, Self, Scholarship)?"
- Is 'sop_status' "NOT_STARTED"? -> Ask "Have you started your SOP? (Draft, Ready, Not Started)"

**STEP 3: COMPLETION CHECK**
- IF ('sop_status' is "READY" or "DRAFT") AND (All other critical fields are set):
- **OUTPUT TEXT**: "You have completed your profile! Please click the 'Complete Profile' button on the left, or let me know if you want to edit anything."
- **DO NOT ASK ANY MORE QUESTIONS.**

## CRITICAL RULES:
1. **SAVE IMMEDIATELY**: If the user answers X, you MUST return an action to update X.
2. **NO REPEATS**: If a field is already in "CURRENT PROFILE STATE", DO NOT ask for it. Move to the next missing item.
4. **NO CHITCHAT / NO CONFIRMATIONS**: 
   - **DO NOT SAY**: "Great", "To confirm", "You said X", "Got it".
   - **DO NOT REPEAT** what the user just said. 
   - **JUST ASK** the question from STEP 2 immediately.
   - Example: User says "CS" -> Your response: "What degree are you targeting?" (NOT "Great, CS. What degree...")

5. **SOP IS THE END**: Once SOP is set to DRAFT or READY, trigger the completion message.

## RESPONSE FORMAT (JSON):
{
  "text": "Your question or completion message",
  "suggested_options": { "type": "single", "values": [...] },
  "actions": [
    {
      "type": "UPDATE_ONBOARDING_STATE",
      "payload": { "field_name": "value" }
    }
  ]
}

User Query: ${userQuery}
`;
    } else {
        // DEFAULT COUNSELLOR PROMPT
        systemPrompt = `You are an EXPERT Study Abroad AI Counsellor and SPARRING PARTNER. You see EVERYTHING the user does in real-time.
    
## USER PROFILE
${JSON.stringify(userContext.profile, null, 2)}

## PROFILE ANALYSIS
Strengths: ${userContext.profileStrength.strengths.join(", ") || "None identified yet"}
Weaknesses: ${userContext.profileStrength.weaknesses.join(", ") || "None identified yet"}
Overall Score: ${userContext.profileStrength.score}/100
Critical Gaps: ${userContext.gaps.map(g => g.message).join(", ") || "None"}

## CURRENT STAGE: ${userContext.stage}
${stageGuidance[userContext.stage]}

## USER MOMENTUM 🆕
Actions This Week: ${userContext.momentum.actionsThisWeek}
Momentum Level: ${userContext.momentum.momentum}
Last Action: ${userContext.momentum.lastAction ?
                `${userContext.momentum.lastAction.activity_type} - ${Math.floor((Date.now() - new Date(userContext.momentum.lastAction.created_at)) / (1000 * 60 * 60))}h ago` :
                'None recently'}

## RECENT ACTIVITIES (Last 20 actions) 🆕
${userContext.activities.length > 0 ? userContext.activities.slice(0, 10).map(formatActivity).join('\n') : '- No recent activity'}

## SHORTLISTED UNIVERSITIES (${userContext.shortlist.length})
${userContext.shortlist.length > 0 ? userContext.shortlist.map(s => `- ${s.university.name} (${s.category}): ${s.university.country}`).join("\n") : '- None yet'}

## LOCKED UNIVERSITIES (${userContext.locks.length})
${userContext.locks.length > 0 ? userContext.locks.map(l => `- ${l.university.name}: Locked on ${new Date(l.locked_at).toLocaleDateString()}`).join("\n") : '- None yet'}

## PENDING TASKS (${userContext.tasks.filter(t => t.status !== 'DONE').length})
${userContext.tasks.filter(t => t.status !== 'DONE').map(t => `- ${t.title} (${t.status})`).join("\n") || '- No pending tasks'}

---

## YOUR ROLE AS SPARRING PARTNER

You are NOT just a Q&A bot. You are a PROACTIVE guide who:

1. **OBSERVES** - You see every action they take
2. **ENCOURAGES** - Celebrate progress ("Great job locking Stanford!")
3. **GUIDES** - Suggest logical next steps based on recent activity
4. **CHALLENGES** - Point out if they're not balanced (all DREAM schools = risky)
5. **PREVENTS MISTAKES** - Warn if budget/GPA don't match their picks
6. **SPARRING** - Engage in strategic discussion, push back when needed

### Context-Aware Responses

If they just:
- **Added to shortlist** → Encourage, suggest similar universities, recommend next step
- **Locked university** → Congratulate, create application tasks automatically
- **Completed task** → Praise momentum, suggest what's next
- **No activity in days** → Gentle nudge to keep moving forward
- **All DREAM schools** → Challenge: "You need TARGET and SAFE schools too"
- **Budget mismatch** → Warn: "Some selections exceed your budget"

## QUERY INTENT ANALYSIS ⚠️ CRITICAL

**BEFORE responding, analyze the user's query to determine what they're asking for:**

### If the query is SPECIFICALLY about tasks (e.g., "show me tasks", "what tasks do I have", "create task for..."):
- **DO NOT** include "recommendations" array (university suggestions)
- **ONLY** include "actions" with type "CREATE_TASK"
- Focus your "text" response on tasks and task management
- "nextSteps" should be task-related only

### If the query is SPECIFICALLY about universities (e.g., "recommend universities", "what schools should I apply to"):
- Include "recommendations" array with university suggestions
- Include "actions" with type "SUGGEST_SHORTLIST"
- Do NOT create random tasks

### If the query is GENERAL or about overall progress:
- You may include both recommendations and task actions as appropriate
- Be balanced and comprehensive

**Examples:**
- Query: "What tasks should I complete?" → Response: Only tasks, no university recommendations
- Query: "Which universities match my profile?" → Response: Only university recommendations, no task actions
- Query: "How am I doing?" → Response: Comprehensive overview with both if relevant

## RESPONSE FORMAT (JSON)
{
  "text": "Your WARM, PERSONALIZED response acknowledging recent activity + guidance",
  "tone": "ENCOURAGING|CHALLENGING|CELEBRATING|NUDGING",
  "reasoning": {
    "activityAssessment": "What they've been doing lately",
    "profileAssessment": "Strength/gap analysis",
    "stageGuidance": "What to focus on now",
    "riskAssessment": "Overall strategy risk"
  },
  "recommendations": [
    {
      "university": "Stanford University",
      "category": "DREAM|TARGET|SAFE",
      "acceptanceChance": 65,
      "reasoning": "Based on your GPA and recent CS project...",
      "risks": ["Highly competitive"],
      "strengths": ["Strong research fit"]
    }
  ],
  "actions": [
    {"type": "SUGGEST_SHORTLIST", "payload": {"univ_external_id": "University Name", "country": "Germany", "category": "TARGET"}},
    {"type": "CREATE_TASK", "payload": {"title": "...", "due_date": "2026-09-01"}},
    {"type": "RECOMMEND_LOCK", "payload": {"university_id": "...", "reason": "..."}}
  ],
  "nextSteps": ["Complete IELTS", "Draft SOP", "Research 2 more TARGET schools"]
}

IMPORTANT for SUGGEST_SHORTLIST actions:
- Use the FULL university name as "univ_external_id" (e.g., "Technical University of Munich")
- ALWAYS include "country" field (e.g., "Germany", "USA", "UK")
- This enables AI enrichment for universities not in our database
- Works for ALL countries including Germany, France, Netherlands, etc.

User Query: ${userQuery || 'Check-in on my progress'}

BE SPECIFIC. BE ENCOURAGING. BE HONEST. ACT LIKE A COACH. ANALYZE THE QUERY INTENT CAREFULLY.`;
    }

    const messages = [
        { role: 'user', content: userQuery || 'Help me get started with my study abroad planning' }
    ];

    // Determine model strategy based on mode
    // ONBOARDING / SEARCH -> gemini-2.5-flash-lite (Primary) -> gemini-2.5-flash (Secondary)
    // COUNSELLOR -> gemini-2.5-flash (Primary) -> gemini-2.5-flash-lite (Secondary)

    let preferredModel = 'gemini-2.5-flash'; // Default standard
    if (mode === 'ONBOARDING' || mode === 'SEARCH') {
        preferredModel = 'gemini-2.5-flash-lite';
    }

    // Use GEMINI as primary for all modes, with GROQ as ultimate fallback
    const response = await getLLMResponse(messages, systemPrompt, {
        provider: 'GEMINI',
        model: preferredModel
    });
    return response;
}

/**
 * Enrich university data using AI (with caching)
 */
async function enrichUniversity(name, country) {
    const { getCachedEnrichment, setCachedEnrichment, calculateConfidenceScore } = require('./cacheService');

    // Check cache first
    // Check cache first
    const cached = await getCachedEnrichment(name, country);
    if (cached && !cached.error) {
        console.log(`✓ Cache hit for ${name}, ${country} (confidence: ${cached._cache_meta.confidence_score})`);
        return cached;
    }

    if (cached && cached.error) {
        console.log(`⚠️ Ignoring cached error for ${name}, ${country} - retrying...`);
    }

    console.log(`⚡ Cache miss for ${name}, ${country} - calling AI...`);

    const systemPrompt = `You are a university data expert. Provide detailed information for "${name}" in "${country}" as a strictly formatted JSON object.
    
    Return ONLY this JSON structure (no markdown, no extra text):
    {
        "name": "Official Name",
        "country": "${country}",
        "city": "City Name (e.g. London, Boston)",
        "domain": "university-website.edu (or .com/etc)",
        "tuition_estimate": 0 (integer USD per year estimate for international students),
        "acceptance_rate": 0.0 (percentage estimate, e.g. 25.5),
        "rank": 0 (integer global rank estimate, e.g. 50),
        "description": "Short description (max 200 chars)",
        "popular_majors": ["Major 1", "Major 2"]
    }
    
    If exact data is unknown, provide a reasonable estimate based on similar institutions in that region.`;

    const messages = [{ role: 'user', content: `Enrich data for ${name} in ${country}` }];

    try {
        // Use Gemini Flash Lite for data enrichment (Fast & Cheap)
        const response = await getLLMResponse(messages, systemPrompt, {
            provider: 'GEMINI',
            model: 'gemini-2.5-flash-lite'
        });

        let enrichedData;

        // 1. Check if response is already a valid object (parsed by callGroq)
        if (response && (response.name || response.tuition_estimate || response.city)) {
            enrichedData = response;
        }
        // 2. Otherwise try to parse from text
        else if (typeof response === 'string' || response.text) {
            const text = response.text || response;
            const jsonMatch = text.match(/\{[\s\S]*\}/);

            if (jsonMatch) {
                try {
                    enrichedData = JSON.parse(jsonMatch[0]);
                } catch (e) {
                    const cleaned = jsonMatch[0].replace(/```json/g, '').replace(/```/g, '').trim();
                    try {
                        enrichedData = JSON.parse(cleaned);
                    } catch (e2) {
                        console.warn('Enrichment parse failed:', text.substring(0, 100));
                        enrichedData = { name, country, error: 'Failed to parse AI response' };
                    }
                }
            } else {
                enrichedData = { name, country, error: 'Failed to parse AI response' };
            }
        } else {
            enrichedData = response;
        }

        // Determine source based on which AI was used
        const source = response._aiSource || 'AI'; // callGemini/callGroq should set this

        // Store in cache
        await setCachedEnrichment(name, country, enrichedData, source);

        // Return with cache metadata
        const confidence = calculateConfidenceScore(enrichedData, source, false);

        return {
            ...enrichedData,
            _cache_meta: {
                cached: false,
                confidence_score: confidence,
                source: source,
                is_verified: false,
                created_at: new Date().toISOString(),
                access_count: 1
            }
        };
    } catch (error) {
        console.error('Enrichment failed:', error);
        return {
            name,
            country,
            error: 'Failed to enrich',
            _cache_meta: {
                cached: false,
                confidence_score: 0,
                source: 'ERROR'
            }
        };
    }
}

/**
 * Generate Application Guidance (Docs & Timeline)
 */
async function generateApplicationGuidance(universityName, country, userContext = {}) {
    const systemPrompt = `You are an expert Study Abroad Application Counsellor.
    Create a detailed application guide for "${universityName}" in "${country}".
    
    Target Student Profile:
    - Current Level: ${userContext.education_level || 'Student'}
    - Target Degree: ${userContext.target_degree || 'Masters'}
    - Major: ${userContext.field_of_study || 'General'}
    
    Return a STRICT JSON object with this structure:
    {
      "required_documents": [
        "Detailed document 1 (e.g. 'Official Transcripts with WES evaluation')",
        "Detailed document 2",
        "..."
      ],
      "timeline": [
        { "phase": "Preparation", "date_range": "Aug - Sep", "description": "Prepare standardized tests (GRE/IELTS)" },
        { "phase": "Application", "date_range": "Oct - Dec", "description": "Submit main application and pay fees" },
        { "phase": "Decision", "date_range": "Mar - Apr", "description": "Receive admission decision" }
      ],
      "application_tips": [
        "Tip 1 specific to this university/country",
        "Tip 2"
      ]
    }
    
    Be specific to the country (e.g. USA needs WES, UK needs CAS, Germany needs VPS/APS).`;

    const messages = [{ role: 'user', content: `Generate application guidance for ${universityName}` }];

    try {
        // Use Gemini Flash for detailed structured guidance
        const response = await getLLMResponse(messages, systemPrompt, {
            provider: 'GEMINI',
            model: 'gemini-2.5-flash'
        });

        let guidance;

        // 1. Check if response is already a valid object (parsed by callGroq)
        if (response && (response.required_documents || response.timeline)) {
            guidance = response;
        }
        // 2. Otherwise try to parse from text
        else if (typeof response === 'string' || response.text) {
            const text = response.text || response;
            const jsonMatch = text.match(/\{[\s\S]*\}/);

            if (jsonMatch) {
                try {
                    guidance = JSON.parse(jsonMatch[0]);
                } catch (e) {
                    // Try aggressive cleanup
                    const cleaned = jsonMatch[0].replace(/```json/g, '').replace(/```/g, '').trim();
                    try {
                        guidance = JSON.parse(cleaned);
                    } catch (e2) {
                        console.warn('Failed to parse AI response text:', text.substring(0, 100));
                        throw new Error('Failed to parse AI response');
                    }
                }
            } else {
                throw new Error('Failed to parse AI response: No JSON found');
            }
        } else {
            // Fallback
            guidance = response;
        }

        return {
            ...guidance,
            _generated_at: new Date().toISOString()
        };

    } catch (error) {
        console.error('Application guidance generation failed:', error);
        // Return fallback
        return {
            required_documents: ["Official Transcripts", "Resume/CV", "Statement of Purpose (SOP)", "Letters of Recommendation"],
            timeline: [
                { phase: "Apply", date_range: "Check Website", description: "Visit university website for official deadlines" }
            ],
            application_tips: ["Please verify all requirements on the official website."],
            error: true
        };
    }
}

module.exports = {
    generateAIResponse,
    enrichUniversity,
    generateApplicationGuidance,
    callGemini,
    callGroq,
    getLLMResponse
};
