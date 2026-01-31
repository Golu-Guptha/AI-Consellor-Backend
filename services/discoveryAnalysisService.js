const supabase = require('../database/supabase');
const { getLLMResponse } = require('./aiService');

/**
 * Analyze university fit for Discovery page
 * Returns lighter analysis than shortlist (faster, for browsing)
 */
async function analyzeUniversityForDiscovery(userId, universityId) {
    try {
        console.log(`🔍 Discovery analysis: user ${userId}, university ${universityId}`);

        // 1. Fetch user profile FIRST (to validate cache quality)
        const { data: profile } = await supabase
            .from('profiles')
            .select('*')
            .eq('user_id', userId)
            .single();

        if (profile) {
            console.log(`👤 Profile found: Budget $${profile.budget_max || 'N/A'}, Countries: ${profile.preferred_countries?.join(',') || 'None'}`);
        } else {
            console.warn('⚠️ No profile found for user');
        }

        // 2. Check cache
        const cached = await getCachedAnalysis(userId, universityId);

        // Define what makes a cache "valid" for THIS user
        const isGenericCache = cached?.analysis?.profile_fit?.reasons?.[0]?.includes('Complete your profile');
        const shouldIgnoreCache = profile && isGenericCache;

        if (cached && !isStale(cached.analyzed_at) && isValidAnalysis(cached.analysis) && !shouldIgnoreCache) {
            console.log('✅ Cache hit for discovery analysis');
            return cached.analysis;
        }

        if (shouldIgnoreCache) {
            console.log('🔄 Ignoring cached generic analysis because user has profile now');
        } else if (cached) {
            console.log('⚠️ Cache invalid/stale/incomplete, re-analyzing...');
        }

        // If no profile exists, don't waste AI tokens - return defaults
        if (!profile) {
            console.log('⚠️ No profile found for user, returning defaults');
            return getDefaultAnalysis();
        }

        // 3. Fetch university data
        const { data: university, error: universityError } = await supabase
            .from('universities')
            .select('*')
            .eq('id', universityId)
            .single();

        if (!university) {
            throw new Error('University not found');
        }

        console.log(`🤖 Calling AI for ${university.name}...`);

        // 4. Build optimized prompt (shorter than shortlist)
        // Ensure defaults if profile is null
        const safeProfile = profile || {};
        const systemPrompt = buildDiscoveryPrompt(safeProfile, university);

        // 5. Call AI
        const messages = [{ role: 'user', content: `Analyze ${university.name} for discovery browsing` }];
        // Use GROQ for Discovery (browsing needs speed)
        const response = await getLLMResponse(messages, systemPrompt, 'GROQ');

        // 6. Parse response with robust cleanup
        let analysis;
        try {
            // Check if response has actual analysis data (prioritize this over .text property)
            if (response && typeof response === 'object' && (response.profile_fit || response.budget_analysis)) {
                // Response is already the analysis object - use it directly
                analysis = response;
                console.log('✅ Response is already an analysis object');
            }
            // Otherwise try to parse from text
            else if (typeof response === 'string' || response.text) {
                const text = response.text || response;

                // Clean up markdown code blocks and extra whitespace
                const cleanedText = text
                    .replace(/```json\n?/g, '')
                    .replace(/```\n?/g, '')
                    .trim();

                // Try to extract JSON object
                const jsonMatch = cleanedText.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    try {
                        analysis = JSON.parse(jsonMatch[0]);
                    } catch (parseError) {
                        // Try additional cleanup for common issues
                        const furtherCleaned = jsonMatch[0]
                            .replace(/,\s*}/g, '}')  // Remove trailing commas
                            .replace(/,\s*]/g, ']')  // Remove trailing commas in arrays
                            .trim();
                        analysis = JSON.parse(furtherCleaned);
                    }
                } else {
                    console.error('❌ No JSON object found in AI response');
                    console.error('Response preview:', cleanedText.substring(0, 200));
                    throw new Error('No JSON object found in response');
                }
            } else {
                // Assume response is already the analysis object
                analysis = response;
            }
        } catch (parseError) {
            console.error('❌ Failed to parse discovery analysis:', parseError.message);
            console.error('Response type:', typeof response);
            if (response) {
                const preview = typeof response === 'string' ? response.substring(0, 300) :
                    response.text ? response.text.substring(0, 300) :
                        JSON.stringify(response).substring(0, 300);
                console.error('Response preview:', preview);
            }
            // Return defaults on parse error instead of throwing
            console.warn('⚠️ Using default analysis due to parse error');
            return getDefaultAnalysis();
        }

        // Validate generated analysis before caching
        if (!isValidAnalysis(analysis)) {
            console.warn('⚠️ Generated analysis incomplete, merging with defaults');
            analysis = { ...getDefaultAnalysis(), ...analysis };
        }

        // 7. Cache the result
        await cacheAnalysis(userId, universityId, analysis);

        console.log('✅ Discovery analysis complete');
        return analysis;

    } catch (error) {
        console.error('❌ Discovery analysis failed:', error.message);
        return getDefaultAnalysis();
    }
}

/**
 * Validate analysis structure
 */
function isValidAnalysis(analysis) {
    return analysis &&
        analysis.profile_fit &&
        analysis.budget_analysis &&
        analysis.country_preference &&
        analysis.acceptance_score &&
        analysis.risk_level;
}

/**
 * Build optimized prompt for Discovery (faster than shortlist)
 */
function buildDiscoveryPrompt(profile, university) {
    const preferredCountries = profile.preferred_countries || [];
    const countryMatches = preferredCountries.includes(university.country);

    return `You are a university matching expert. Provide a QUICK analysis for discovery browsing.

STUDENT PROFILE:
- GPA: ${profile.gpa || 'N/A'}
- Major: ${profile.field_of_study || 'N/A'}
- Budget: $${profile.budget_max || 'N/A'}/year
- Preferred Countries: ${preferredCountries.join(', ') || 'Any'}
- Test Scores: GRE ${profile.gre_score || 'N/A'}, IELTS ${profile.ielts_score || 'N/A'}

UNIVERSITY:
- Name: ${university.name}
- Country: ${university.country}
- Tuition: $${university.tuition_estimate || 'N/A'}/year
- Acceptance Rate: ${university.acceptance_rate || 'N/A'}%
- Rank: ${university.rank || 'N/A'}

Return ONLY this JSON (no markdown, keep it brief):
{
  "profile_fit": {
    "reasons": ["Brief reason 1", "Brief reason 2"],
    "score": 0-100
  },
  "budget_analysis": {
    "tuition": ${university.tuition_estimate || 'null'},
    "user_budget": ${profile.budget_max || 0},
    "within_budget": ${university.tuition_estimate ? university.tuition_estimate <= profile.budget_max : 'null'},
    "gap": ${university.tuition_estimate && profile.budget_max ? Math.max(0, university.tuition_estimate - profile.budget_max) : 'null'},
    "recommendation": "Brief one-liner"
  },
  "country_preference": {
    "matches": ${countryMatches},
    "message": "${countryMatches ? `${university.country} is in your preferences` : `${university.country} is not in your preferred countries`}"
  },
  "acceptance_score": {
    "percentage": 0-100,
    "category": "DREAM|TARGET|SAFE",
    "reasoning": "One sentence max"
  },
  "risk_level": "low|medium|high",
  "cost_level": "low|medium|high"
}

IMPORTANT: If tuition is null, estimate it based on university type and country. Public US universities: $10k-30k, Private: $40k-70k, European: $0-20k.`;
}

/**
 * Get cached analysis
 */
async function getCachedAnalysis(userId, universityId) {
    const { data, error } = await supabase
        .from('user_university_analyses')
        .select('*')
        .eq('user_id', userId)
        .eq('university_id', universityId)
        .single();

    if (error || !data) return null;
    return data;
}

/**
 * Check if analysis is stale (older than 7 days)
 */
function isStale(analyzedAt) {
    const CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days
    const age = Date.now() - new Date(analyzedAt).getTime();
    return age > CACHE_TTL;
}

/**
 * Cache analysis result
 */
async function cacheAnalysis(userId, universityId, analysis) {
    const { error } = await supabase
        .from('user_university_analyses')
        .upsert({
            user_id: userId,
            university_id: universityId,
            analysis: analysis,
            analyzed_at: new Date().toISOString()
        }, {
            onConflict: 'user_id,university_id'
        });

    if (error) {
        console.error('Failed to cache analysis:', error);
    }
}

/**
 * Get default analysis when AI fails or profile is missing
 */
function getDefaultAnalysis() {
    return {
        profile_fit: {
            reasons: ["Complete your profile to see personalized insights"],
            score: 50
        },
        budget_analysis: {
            tuition: 0,
            user_budget: 0,
            within_budget: true,
            gap: 0,
            recommendation: "Set your budget in profile to see cost analysis"
        },
        country_preference: {
            matches: false,
            message: "Set country preferences to see matches"
        },
        acceptance_score: {
            percentage: 50,
            category: "TARGET",
            reasoning: "Complete profile for accurate assessment"
        },
        risk_level: "medium",
        cost_level: "medium"
    };
}

/**
 * Batch analyze multiple universities with a SINGLE AI call
 * Much more efficient than calling AI individually for each university
 */
async function batchAnalyzeUniversities(userId, universityIds) {
    console.log(`\n📊 ========== BATCH ANALYSIS STARTING ==========`);
    console.log(`🎯 Analyzing ${universityIds.length} universities for user ${userId}`);

    try {
        // 1. Fetch user profile
        const { data: profile } = await supabase
            .from('profiles')
            .select('*')
            .eq('user_id', userId)
            .single();

        if (!profile) {
            console.warn('⚠️  No profile found, using defaults for all');
            return createDefaultAnalyses(universityIds);
        }

        // 2. Fetch all universities
        const { data: universities } = await supabase
            .from('universities')
            .select('*')
            .in('id', universityIds);

        if (!universities || universities.length === 0) {
            console.error('❌ No universities found');
            return {};
        }

        console.log(`📚 Fetched ${universities.length} universities from database`);

        // 3. Build university list for prompt
        const universityList = universities.map((uni, idx) =>
            `${idx + 1}. ${uni.name} (${uni.country}) - $${uni.tuition_estimate || 'N/A'}/year, ${uni.acceptance_rate || 'N/A'}% acceptance`
        ).join('\n');

        // 4. Build optimized batch prompt
        const preferred_countries = profile.preferred_countries || [];
        const systemPrompt = `You are a university matching expert. Analyze ALL universities for this student.

STUDENT PROFILE:
- GPA: ${profile.gpa || 'N/A'}
- Major: ${profile.field_of_study || 'N/A'}
- Budget: $${profile.budget_max || 'N/A'}/year
- Preferred Countries: ${preferred_countries.join(', ') || 'Any'}
- Test Scores: GRE ${profile.gre_score || 'N/A'}, IELTS ${profile.ielts_score || 'N/A'}

UNIVERSITIES TO ANALYZE:
${universityList}

Return ONLY a JSON array matching this EXACT structure:
[
  {
    "index": 1,
    "profile_fit": { "reasons": ["reason1", "reason2"], "score": 75 },
    "budget_analysis": { "within_budget": true, "gap": 0, "recommendation": "Affordable" },
    "country_preference": { "matches": true, "message": "Matches your preference" },
    "acceptance_score": { "percentage": 65, "category": "TARGET", "reasoning": "Good fit" },
    "risk_level": "medium",
    "cost_level": "low"
  },
  ...
]

IMPORTANT:
- Return ONLY valid JSON array, no markdown
- One object per university, ordered by index
- Use categories: DREAM (10-40%), TARGET (40-70%), SAFE (70%+)
- risk_level: low|medium|high
- cost_level: low|medium|high (relative to student budget)`;

        const prompt = `Analyze all ${universities.length} universities for this student's profile.`;

        console.log(`🤖 Calling AI for batch analysis of ${universities.length} universities...`);

        // 5. Single AI call for all universities (GROQ for speed)
        const response = await getLLMResponse([
            { role: 'user', content: prompt }
        ], systemPrompt, 'GROQ');

        // 6. Parse response
        let analysisArray;
        try {
            if (Array.isArray(response)) {
                console.log(`✅ Response is already an array with ${response.length} items`);
                analysisArray = response;
            } else if (typeof response === 'string' || response.text) {
                const text = response.text || response;
                const cleanedResponse = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

                console.log('🔍 Attempting to extract JSON array from text response...');
                console.log('Response preview (first 300 chars):', cleanedResponse.substring(0, 300));

                // Try to extract JSON array with improved regex
                const arrayMatch = cleanedResponse.match(/\[[\s\S]*\]/);
                if (arrayMatch) {
                    analysisArray = JSON.parse(arrayMatch[0]);
                    console.log(`✅ Successfully parsed array with ${analysisArray.length} items`);
                } else {
                    console.error('❌ No JSON array found in response');
                    console.error('Full response text:', cleanedResponse);
                    return createDefaultAnalyses(universityIds);
                }
            } else {
                analysisArray = response;
            }
        } catch (parseError) {
            console.error('Failed to parse batch analysis response:', parseError.message);
            console.error('Parse error details:', parseError);
            if (response) {
                const preview = typeof response === 'string' ? response.substring(0, 500) :
                    response.text ? response.text.substring(0, 500) :
                        JSON.stringify(response).substring(0, 500);
                console.error('Response that failed to parse (first 500 chars):', preview);
            }
            return createDefaultAnalyses(universityIds);
        }

        // 7. Map analyses to university IDs
        const analysisMap = {};
        universities.forEach((uni, idx) => {
            const aiAnalysis = analysisArray.find(a => a.index === idx + 1);
            if (aiAnalysis) {
                // Remove index field before storing
                const { index, ...analysis } = aiAnalysis;
                analysisMap[uni.id] = analysis;
            } else {
                analysisMap[uni.id] = getDefaultAnalysis();
            }
        });

        // 8. Cache all analyses
        console.log(`💾 Caching ${Object.keys(analysisMap).length} analyses...`);
        await Promise.all(
            Object.entries(analysisMap).map(([uniId, analysis]) =>
                cacheAnalysis(userId, uniId, analysis).catch(err =>
                    console.error(`Failed to cache analysis for ${uniId}:`, err.message)
                )
            )
        );

        const aiSource = response._aiSource || 'AI';
        console.log(`✅ Batch analysis complete: ${Object.keys(analysisMap).length}/${universityIds.length} universities using ${aiSource}`);
        console.log(`========== BATCH ANALYSIS COMPLETE ==========\n`);

        return analysisMap;

    } catch (error) {
        console.error('❌ Batch analysis failed:', error.message);
        return createDefaultAnalyses(universityIds);
    }
}

/**
 * Create default analyses for all university IDs
 */
function createDefaultAnalyses(universityIds) {
    const defaultMap = {};
    universityIds.forEach(id => {
        defaultMap[id] = getDefaultAnalysis();
    });
    console.log(`⚠️  Created default analyses for ${universityIds.length} universities`);
    return defaultMap;
}

/**
 * Invalidate cache when user updates profile
 */
async function invalidateUserCache(userId) {
    const { error } = await supabase
        .from('user_university_analyses')
        .delete()
        .eq('user_id', userId);

    if (error) {
        console.error('Failed to invalidate cache:', error);
    } else {
        console.log(`🗑️ Invalidated cache for user ${userId}`);
    }
}

module.exports = {
    analyzeUniversityForDiscovery,
    batchAnalyzeUniversities,
    invalidateUserCache
};
