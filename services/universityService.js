const axios = require('axios');
const supabase = require('../database/supabase');
const { batchEnrichUniversitiesWithSingleCall } = require('./universityEnrichment');

// Cache TTL in milliseconds
const HIPOLABS_CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days
const SCORECARD_CACHE_TTL = 24 * 60 * 60 * 1000; // 1 day

// Country name variations and common mistakes
const COUNTRY_ALIASES = {
    // United States variations
    'united states': 'United States',
    'usa': 'United States',
    'us': 'United States',
    'america': 'United States',
    'united state': 'United States',
    'u.s.a': 'United States',
    'u.s': 'United States',

    // United Kingdom variations
    'united kingdom': 'United Kingdom',
    'uk': 'United Kingdom',
    'britain': 'United Kingdom',
    'great britain': 'United Kingdom',
    'england': 'United Kingdom',
    'u.k': 'United Kingdom',

    // Canada variations
    'canada': 'Canada',
    'cananda': 'Canada',
    'canda': 'Canada',

    // Australia variations
    'australia': 'Australia',
    'aus': 'Australia',
    'austrailia': 'Australia',

    // India variations
    'india': 'India',
    'bharat': 'India',

    // Germany variations
    'germany': 'Germany',
    'deutschland': 'Germany',

    // France variations
    'france': 'France',

    // Netherlands variations
    'netherlands': 'Netherlands',
    'holland': 'Netherlands',

    // Singapore variations
    'singapore': 'Singapore',
    'singapur': 'Singapore',

    // Ireland variations
    'ireland': 'Ireland',
    'eire': 'Ireland',

    // New Zealand variations
    'new zealand': 'New Zealand',
    'newzealand': 'New Zealand',
    'nz': 'New Zealand'
};

/**
 * Normalize country name to handle typos and variations
 */
function normalizeCountryName(country) {
    if (!country) return null;

    const normalized = country.toLowerCase().trim();

    // Direct match
    if (COUNTRY_ALIASES[normalized]) {
        return COUNTRY_ALIASES[normalized];
    }

    // Find close match using simple string similarity
    const entries = Object.entries(COUNTRY_ALIASES);
    for (const [alias, canonical] of entries) {
        if (alias.includes(normalized) || normalized.includes(alias)) {
            return canonical;
        }
    }

    // Return original capitalized if no match
    return country.charAt(0).toUpperCase() + country.slice(1).toLowerCase();
}

/**
 * Search universities using Hipolabs API
 */
async function searchHipolabs(name, country) {
    try {
        const params = {};
        if (name) params.name = name;
        if (country) {
            // Normalize country name for better matching
            params.country = normalizeCountryName(country);
        }

        const response = await axios.get('http://universities.hipolabs.com/search', {
            params,
            timeout: 10000 // 10 second timeout
        });
        return response.data;
    } catch (error) {
        if (error.code === 'ECONNABORTED') {
            console.error('Hipolabs API timeout - API took too long to respond');
        } else {
            console.error('Hipolabs API error:', error.message);
        }
        return [];
    }
}

/**
 * Fetch US university data from College Scorecard API
 */
async function fetchCollegeScorecard(schoolName) {
    const apiKey = process.env.COLLEGE_SCORECARD_API_KEY;

    if (!apiKey) {
        console.warn('COLLEGE_SCORECARD_API_KEY not configured');
        return null;
    }

    try {
        const response = await axios.get('https://api.data.gov/ed/collegescorecard/v1/schools', {
            params: {
                api_key: apiKey,
                'school.name': schoolName,
                _fields: 'school.name,latest.cost.tuition.in_state,latest.cost.tuition.out_of_state,latest.admissions.admission_rate.overall,latest.student.enrollment.all',
                per_page: 1
            }
        });

        if (response.data.results && response.data.results.length > 0) {
            const result = response.data.results[0];
            return {
                tuition_estimate: result.latest?.cost?.tuition?.out_of_state || result.latest?.cost?.tuition?.in_state,
                acceptance_rate: result.latest?.admissions?.admission_rate?.overall
                    ? (result.latest.admissions.admission_rate.overall * 100).toFixed(2)
                    : null
            };
        }

        return null;
    } catch (error) {
        console.error('College Scorecard API error:', error.message);
        return null;
    }
}

/**
 * Find or create university in database
 */
async function findOrCreateUniversity(universityData) {
    const externalId = universityData.domain || `${universityData.name}_${universityData.country}`;

    // Check if university exists in cache
    const { data: existing } = await supabase
        .from('universities')
        .select('*')
        .eq('external_id', externalId)
        .single();

    if (existing) {
        // Check if cache is still valid
        const cacheAge = Date.now() - new Date(existing.cached_at).getTime();
        const ttl = existing.data_source === 'COLLEGE_SCORECARD' ? SCORECARD_CACHE_TTL : HIPOLABS_CACHE_TTL;

        if (cacheAge < ttl) {
            return existing;
        }
    }

    // Create or update university
    const uniData = {
        external_id: externalId,
        name: universityData.name,
        country: universityData.country,
        domain: universityData.domain || null,
        city: universityData.city || null,
        data_source: universityData.data_source || 'HIPOLABS',
        tuition_estimate: universityData.tuition_estimate || null,
        acceptance_rate: universityData.acceptance_rate || null,
        rank: universityData.rank || null,
        cached_at: new Date().toISOString()
    };

    const { data, error } = await supabase
        .from('universities')
        .upsert(uniData, { onConflict: 'external_id' })
        .select()
        .single();

    if (error) {
        console.error('Database upsert error:', error);
        return universityData; // Return raw data if DB fails
    }

    return data;
}

/**
 * Search and cache universities (OPTIMIZED)
 */
async function searchUniversities({ name, country, enrichUS = true, limit = 100 }) {
    // Search Hipolabs
    let hipolabsResults = await searchHipolabs(name, country);

    // Limit results to prevent slow queries
    if (hipolabsResults.length > limit) {
        hipolabsResults = hipolabsResults.slice(0, limit);
    }

    // FALLBACK: If Hipolabs fails, search database directly
    if (hipolabsResults.length === 0) {
        console.log('⚠️ Hipolabs returned no results, searching database...');

        const query = supabase.from('universities').select('*');

        if (name) {
            query.ilike('name', `%${name}%`);
        }
        if (country) {
            const normalizedCountry = normalizeCountryName(country);
            query.eq('country', normalizedCountry);
        }

        const { data: dbResults, error } = await query.limit(limit);

        if (!error && dbResults && dbResults.length > 0) {
            console.log(`✅ Found ${dbResults.length} universities in database cache`);
            return dbResults;
        }

        console.log('❌ No universities found in database either');
        return [];
    }

    // Batch check existing universities in database
    const externalIds = hipolabsResults.map(uni =>
        uni.domains?.[0] || `${uni.name}_${uni.country}`
    );

    const { data: existingUniversities } = await supabase
        .from('universities')
        .select('*')
        .in('external_id', externalIds);

    const existingMap = new Map(
        (existingUniversities || []).map(uni => [uni.external_id, uni])
    );

    const universities = [];
    const toUpsert = [];
    const usUniversities = [];
    const nonUSUniversities = [];

    // Process results
    for (const uni of hipolabsResults) {
        const externalId = uni.domains?.[0] || `${uni.name}_${uni.country}`;
        const existing = existingMap.get(externalId);

        // Check cache validity
        if (existing) {
            const cacheAge = Date.now() - new Date(existing.cached_at).getTime();
            const ttl = existing.data_source === 'COLLEGE_SCORECARD' ? SCORECARD_CACHE_TTL : HIPOLABS_CACHE_TTL;

            if (cacheAge < ttl) {
                universities.push(existing);
                continue;
            }
        }

        let uniData = {
            external_id: externalId,
            name: uni.name,
            country: uni.country,
            domain: uni.domains?.[0] || null,
            city: uni['state-province'] || null,
            data_source: 'HIPOLABS',
            cached_at: new Date().toISOString()
        };

        // Track US universities for College Scorecard enrichment
        if (enrichUS && uni.country === 'United States') {
            usUniversities.push({ index: toUpsert.length, name: uni.name });
        } else {
            // Track non-US universities for AI enrichment
            nonUSUniversities.push({
                index: toUpsert.length,
                name: uni.name,
                country: uni.country
            });
        }

        toUpsert.push(uniData);
    }

    // Enrich US universities in parallel (max 10 at a time to avoid rate limits)
    if (usUniversities.length > 0) {
        console.log(`🇺🇸 Enriching ${usUniversities.length} US universities with College Scorecard...`);
        const enrichmentPromises = usUniversities.map(({ index, name }) =>
            fetchCollegeScorecard(name).then(scorecardData => {
                if (scorecardData) {
                    toUpsert[index] = {
                        ...toUpsert[index],
                        ...scorecardData,
                        data_source: 'COLLEGE_SCORECARD'
                    };
                }
            }).catch(err => {
                console.error(`Failed to enrich ${name}:`, err.message);
            })
        );

        // Process in batches of 10
        for (let i = 0; i < enrichmentPromises.length; i += 10) {
            await Promise.all(enrichmentPromises.slice(i, i + 10));
        }
    }

    // Enrich non-US universities with AI using a SINGLE batch call
    if (nonUSUniversities.length > 0) {
        const universitiesToEnrich = nonUSUniversities.slice(0, 50); // Increased from 20 to 50
        console.log(`🌍 Batch enriching ${universitiesToEnrich.length} non-US universities with AI...`);

        try {
            // Single API call for all universities
            const enrichmentMap = await batchEnrichUniversitiesWithSingleCall(
                universitiesToEnrich.map(u => ({ name: u.name, country: u.country }))
            );

            console.log(`📦 Enrichment map size:`, Object.keys(enrichmentMap).length);
            console.log(`📊 Sample enrichment data:`, enrichmentMap[0]);

            // Apply enrichment data
            let enrichedCount = 0;
            let defaultCount = 0;
            universitiesToEnrich.forEach(({ index, country }, arrayIndex) => {
                const enrichmentData = enrichmentMap[arrayIndex];

                if (enrichmentData && (enrichmentData.tuition_estimate || enrichmentData.acceptance_rate)) {
                    enrichedCount++;
                    // AI enrichment successful
                    toUpsert[index] = {
                        ...toUpsert[index],
                        tuition_estimate: enrichmentData.tuition_estimate || getDefaultTuitionByCountry(country),
                        acceptance_rate: enrichmentData.acceptance_rate || 50,
                        rank: enrichmentData.ranking || null,
                        data_source: 'OTHER' // Use valid database enum value
                    };
                } else {
                    defaultCount++;
                    // Fallback to default estimates
                    toUpsert[index] = {
                        ...toUpsert[index],
                        tuition_estimate: getDefaultTuitionByCountry(country),
                        acceptance_rate: 50,
                        data_source: 'OTHER'
                    };
                }
            });
            console.log(`✅ Enriched: ${enrichedCount}, ⚠️  Defaults: ${defaultCount}`);
        } catch (error) {
            console.error('Batch AI enrichment failed:', error.message);
            // Fallback: use default estimates for all
            universitiesToEnrich.forEach(({ index, country }) => {
                toUpsert[index] = {
                    ...toUpsert[index],
                    tuition_estimate: getDefaultTuitionByCountry(country),
                    acceptance_rate: 50,
                    data_source: 'OTHER'
                };
            });
        }

        // For remaining universities beyond the 50 limit, add default estimates
        for (let i = 50; i < nonUSUniversities.length; i++) {
            const { index, country } = nonUSUniversities[i];
            toUpsert[index] = {
                ...toUpsert[index],
                tuition_estimate: getDefaultTuitionByCountry(country),
                acceptance_rate: 50,
                data_source: 'OTHER'
            };
        }
    }

    // Batch upsert to database with improved error handling
    if (toUpsert.length > 0) {
        console.log(`💾 Upserting ${toUpsert.length} universities to database...`);
        const { data: upserted, error } = await supabase
            .from('universities')
            .upsert(toUpsert, { onConflict: 'external_id' })
            .select();

        if (error) {
            console.error('❌ Batch upsert error:', error.message);
            console.error('Error details:', error);

            // Critical: If upsert fails, universities won't have IDs, so AI analysis will fail
            // Try to rescue: Fetch IDs for universities that might already exist
            const externalIds = toUpsert.map(u => u.external_id);
            const { data: rescued } = await supabase
                .from('universities')
                .select('*')
                .in('external_id', externalIds);

            if (rescued && rescued.length > 0) {
                console.log(`✅ Rescued ${rescued.length} universities from DB after upsert failure`);
                universities.push(...rescued);
            } else {
                console.warn('⚠️ Could not rescue university IDs - Analysis buttons will be disabled');
                universities.push(...toUpsert);
            }
        } else {
            console.log(`✅ Successfully upserted ${upserted.length} universities`);
            universities.push(...(upserted || []));
        }
    }

    console.log(`✅ Search complete: ${universities.length} universities returned to frontend`);
    // Log the first result to verify ID presence
    if (universities.length > 0) {
        console.log(`🔍 Sample result: ${universities[0].name} (ID: ${universities[0].id || 'MISSING'})`);
    }

    return universities;
}

/**
 * Get default tuition estimate by country for fallback
 */
function getDefaultTuitionByCountry(country) {
    const defaults = {
        'United Kingdom': 25000,
        'Canada': 20000,
        'Australia': 28000,
        'Germany': 1500, // Often free or very low
        'France': 3000,
        'Netherlands': 12000,
        'Singapore': 15000,
        'Ireland': 18000,
        'New Zealand': 22000,
        'Switzerland': 1500,
        'Sweden': 0, // Free for EU students
        'Norway': 0, // Free
        'Denmark': 0, // Free for EU
        'Finland': 0, // Free for EU
        'Spain': 4000,
        'Italy': 4000,
        'India': 5000,
        'China': 8000,
        'Japan': 12000,
        'South Korea': 10000,
        'Brazil': 3000,
        'Mexico': 4000
    };
    return defaults[country] || 15000; // Default to $15k if country not in list
}

/**
 * Manually add a university (or enrich and add)
 */
async function manualAddUniversity(uniData, userId) {
    const externalId = uniData.external_id || uniData.domain || `${uniData.name.replace(/\s+/g, '-').toLowerCase()}_${uniData.country.replace(/\s+/g, '-').toLowerCase()}`;

    // Check if exists
    const { data: existing } = await supabase
        .from('universities')
        .select('*')
        .eq('external_id', externalId)
        .single();

    if (existing) {
        return existing;
    }

    const newUni = {
        external_id: externalId,
        name: uniData.name,
        country: uniData.country,
        domain: uniData.domain || null,
        city: uniData.city || null,
        data_source: 'MANUAL', // Uses the new enum value if migration run, else might error if check constraint not updated
        tuition_estimate: uniData.tuition_estimate || null,
        acceptance_rate: uniData.acceptance_rate || null,
        rank: uniData.rank || null,
        // verified: false, // If column exists
        // added_by_user_id: userId, // If column exists
        cached_at: new Date().toISOString()
    };

    // Try to include new columns if they exist (Supabase ignores extras if setup? No, usually errors).
    // I'll try to insert. If it fails due to missing column, I might need a fallback.
    // For now I'll include them and assume migration.
    newUni.verified = false;
    newUni.added_by_user_id = userId;
    newUni.verification_notes = 'Added manually by user';

    const { data, error } = await supabase
        .from('universities')
        .insert(newUni)
        .select()
        .single();

    if (error) {
        // Fallback: retry without new columns if error relates to column missing or check constraint
        // This is a bit hacky but makes it robust if migration wasn't run
        if (error.message.includes('column') || error.message.includes('check constraint')) {
            delete newUni.verified;
            delete newUni.added_by_user_id;
            delete newUni.verification_notes;
            if (error.message.includes('check constraint')) {
                newUni.data_source = 'OTHER';
            }

            const { data: retryData, error: retryError } = await supabase
                .from('universities')
                .insert(newUni)
                .select()
                .single();

            if (retryError) throw retryError;
            return retryData;
        }
        throw error;
    }

    return data;
}

module.exports = {
    searchUniversities,
    searchHipolabs,
    fetchCollegeScorecard,
    findOrCreateUniversity,
    normalizeCountryName,
    manualAddUniversity
};
