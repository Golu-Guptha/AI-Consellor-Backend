const { getLLMResponse } = require('./aiService');
const supabase = require('../database/supabase');

/**
 * Use AI to enrich university data when not available from API
 * This helps with countries like Germany, France, etc. where API data is limited
 */
async function enrichUniversityWithAI(universityName, country) {
    try {
        const prompt = `Provide detailed information about ${universityName} in ${country} for study abroad planning.

Return a JSON object with this exact structure:
{
  "name": "Full official university name",
  "country": "${country}",
  "city": "Main campus city",
  "domain": "university website domain (e.g., stanford.edu)",
  "tuition_estimate": estimated annual tuition in USD (integer),
  "acceptance_rate": acceptance rate as percentage (e.g., 15.5 for 15.5%),
  "ranking": approximate world ranking (integer, if available),
  "programs": ["Computer Science", "Engineering", ...] (top 5 programs),
  "language_of_instruction": "Primary language",
  "international_students": percentage of international students,
  "description": "Brief 2-sentence description"
}

Be accurate. If you don't know exact data, provide reasonable estimates marked with "~".
Return ONLY valid JSON, no markdown, no explanation.`;

        const response = await callGemini([
            { role: 'user', content: prompt }
        ], 'You are a university database expert. Return only valid JSON.');

        // Parse AI response
        let universityData;
        try {
            // Remove markdown code blocks if present
            const cleanedResponse = response.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
            universityData = JSON.parse(cleanedResponse);
        } catch (parseError) {
            console.error('Failed to parse AI response:', response);
            throw new Error('AI returned invalid data format');
        }

        return universityData;
    } catch (error) {
        console.error('University enrichment error:', error);
        throw error;
    }
}

/**
 * Find or create university with AI enrichment
 * If university doesn't exist in DB, use AI to get details and create it
 */
async function findOrCreateUniversity(universityIdentifier, country = null) {
    try {
        // Try to find by external_id first
        let { data: university, error } = await supabase
            .from('universities')
            .select('*')
            .eq('external_id', universityIdentifier)
            .single();

        if (university) {
            return university;
        }

        // Try to find by name (case-insensitive)
        ({ data: university, error } = await supabase
            .from('universities')
            .select('*')
            .ilike('name', universityIdentifier)
            .limit(1)
            .single());

        if (university) {
            return university;
        }

        // University not found - use AI to enrich and create
        console.log(`University "${universityIdentifier}" not found. Using AI enrichment...`);

        const enrichedData = await enrichUniversityWithAI(
            universityIdentifier,
            country || 'Unknown'
        );

        // Create university in database
        const { data: newUniversity, error: insertError } = await supabase
            .from('universities')
            .insert({
                external_id: `ai_enriched_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                name: enrichedData.name || universityIdentifier,
                country: enrichedData.country || country || 'Unknown',
                city: enrichedData.city,
                domain: enrichedData.domain,
                tuition_estimate: enrichedData.tuition_estimate,
                acceptance_rate: enrichedData.acceptance_rate,
                rank: enrichedData.ranking,
                data_source: 'AI_ENRICHED',
                cached_at: new Date().toISOString()
            })
            .select()
            .single();

        if (insertError) {
            console.error('Failed to insert enriched university:', insertError);
            throw insertError;
        }

        console.log(`✅ Created AI-enriched university: ${newUniversity.name}`);
        return newUniversity;
    } catch (error) {
        console.error('Find or create university error:', error);
        throw error;
    }
}

/**
 * Batch enrich multiple universities
 */
async function batchEnrichUniversities(universities, country) {
    const results = [];

    for (const uniName of universities) {
        try {
            const university = await findOrCreateUniversity(uniName, country);
            results.push({ success: true, university });
        } catch (error) {
            results.push({ success: false, name: uniName, error: error.message });
        }

        // Rate limiting - wait 1 second between AI calls
        await new Promise(resolve => setTimeout(resolve, 1000));
    }

    return results;
}

/**
 * Batch enrich multiple universities in a SINGLE Gemini API call
 * Much more efficient than calling once per university
 */
async function batchEnrichUniversitiesWithSingleCall(universities) {
    try {
        if (!universities || universities.length === 0) {
            return {};
        }

        // Build list of universities to enrich
        const universityList = universities.map((uni, idx) =>
            `${idx + 1}. ${uni.name} (${uni.country})`
        ).join('\n');

        const prompt = `Provide tuition and acceptance rate estimates for the following universities. Return ONLY a JSON array with this exact structure:

[
  {
    "index": 1,
    "tuition_estimate": estimated annual tuition in USD (number only, no strings),
    "acceptance_rate": acceptance rate as percentage (number only, e.g., 15.5 for 15.5%),
    "ranking": approximate world ranking (number, null if unknown)
  },
  ...
]

Universities to enrich:
${universityList}

IMPORTANT:
- Return ONLY valid JSON array, no markdown, no explanation
- Use numbers only, not strings like "~2000"
- If you don't know exact data, provide reasonable estimates
- Index matches the university number in the list above`;

        // Use getLLMResponse which has Gemini→Groq fallback
        const response = await getLLMResponse([
            { role: 'user', content: prompt }
        ], 'You are a university database expert. Return only valid JSON array.');

        // Parse AI response
        let enrichmentData;
        try {
            // Handle different response formats
            if (Array.isArray(response)) {
                console.log(`✅ Response is already an array with ${response.length} items`);
                enrichmentData = response;
            } else if (typeof response === 'string' || response.text) {
                const text = response.text || response;
                const cleanedResponse = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

                console.log('🔍 Attempting to extract JSON array from enrichment response...');

                // Try to extract JSON array with improved regex
                const arrayMatch = cleanedResponse.match(/\[[\s\S]*\]/);
                if (arrayMatch) {
                    enrichmentData = JSON.parse(arrayMatch[0]);
                    console.log(`✅ Successfully parsed enrichment array with ${enrichmentData.length} items`);
                } else {
                    console.warn('⚠️ No JSON array found in enrichment response');
                    console.warn('Response preview:', cleanedResponse.substring(0, 200));
                    return {};
                }
            } else {
                enrichmentData = response;
            }
        } catch (parseError) {
            console.error('Failed to parse batch AI response:', parseError.message);
            console.error('Parse error details:', parseError);
            return {}; // Return empty object on parse error
        }

        // Convert array to map: index -> data
        const enrichmentMap = {};
        if (Array.isArray(enrichmentData)) {
            enrichmentData.forEach(item => {
                if (item.index && typeof item.index === 'number') {
                    enrichmentMap[item.index - 1] = {
                        tuition_estimate: parseNumberOrNull(item.tuition_estimate),
                        acceptance_rate: parseNumberOrNull(item.acceptance_rate),
                        ranking: parseNumberOrNull(item.ranking)
                    };
                }
            });
        }

        const aiSource = response._aiSource || 'AI';
        console.log(`✅ Batch enriched ${Object.keys(enrichmentMap).length}/${universities.length} universities using ${aiSource}`);
        return enrichmentMap;

    } catch (error) {
        console.error('Batch enrichment error:', error.message);
        return {}; // Return empty object on error, fallback to defaults
    }
}

/**
 * Helper to parse numbers that might be strings like "~2000"
 */
function parseNumberOrNull(value) {
    if (value === null || value === undefined) return null;
    if (typeof value === 'number') return value;
    if (typeof value === 'string') {
        // Remove ~ and other non-numeric characters
        const cleaned = value.replace(/[~,\s]/g, '');
        const parsed = parseFloat(cleaned);
        return isNaN(parsed) ? null : parsed;
    }
    return null;
}

module.exports = {
    enrichUniversityWithAI,
    findOrCreateUniversity,
    batchEnrichUniversities,
    batchEnrichUniversitiesWithSingleCall
};
