const supabase = require('../database/supabase');

// Cache TTL in milliseconds
const CACHE_TTL = {
    VERIFIED: 30 * 24 * 60 * 60 * 1000,    // 30 days
    AI_ENRICHED: 7 * 24 * 60 * 60 * 1000,  // 7 days
    MANUAL: 14 * 24 * 60 * 60 * 1000       // 14 days
};

/**
 * Get cached enrichment data
 */
async function getCachedEnrichment(name, country) {
    try {
        const { data, error } = await supabase
            .from('enrichment_cache')
            .select('*')
            .eq('university_name', name.trim())
            .eq('country', country.trim())
            .single();

        if (error || !data) return null;

        // Check if cache is fresh
        const ttl = data.is_verified ? CACHE_TTL.VERIFIED :
            data.source === 'MANUAL' ? CACHE_TTL.MANUAL :
                CACHE_TTL.AI_ENRICHED;

        const cacheAge = Date.now() - new Date(data.created_at).getTime();

        if (cacheAge > ttl) {
            console.log(`Cache expired for ${name}, ${country} (age: ${Math.floor(cacheAge / (1000 * 60 * 60 * 24))} days)`);
            return null; // Cache expired
        }

        // Update access stats
        await updateCacheAccess(data.id);

        return {
            ...data.enriched_data,
            _cache_meta: {
                cached: true,
                confidence_score: parseFloat(data.confidence_score),
                source: data.source,
                is_verified: data.is_verified,
                created_at: data.created_at,
                access_count: data.access_count + 1
            }
        };
    } catch (err) {
        console.error('Cache lookup error:', err);
        return null;
    }
}

/**
 * Store enrichment in cache
 */
async function setCachedEnrichment(name, country, enrichedData, source = 'AI') {
    try {
        // Calculate confidence score
        const confidence = calculateConfidenceScore(enrichedData, source, false);

        const cacheEntry = {
            university_name: name.trim(),
            country: country.trim(),
            enriched_data: enrichedData,
            confidence_score: confidence,
            source: source,
            created_at: new Date().toISOString(),
            last_accessed_at: new Date().toISOString(),
            access_count: 1,
            is_verified: false
        };

        const { data, error } = await supabase
            .from('enrichment_cache')
            .upsert(cacheEntry, { onConflict: 'university_name,country' })
            .select()
            .single();

        if (error) {
            console.error('Cache set error:', error);
            return null;
        }

        return data;
    } catch (err) {
        console.error('Cache storage error:', err);
        return null;
    }
}

/**
 * Update cache access statistics
 */
async function updateCacheAccess(cacheId) {
    try {
        await supabase
            .from('enrichment_cache')
            .update({
                last_accessed_at: new Date().toISOString(),
                access_count: supabase.rpc('increment', { row_id: cacheId })
            })
            .eq('id', cacheId);
    } catch (err) {
        // Non-critical, log and continue
        console.warn('Cache access update failed:', err.message);
    }
}

/**
 * Calculate confidence score for enriched data
 * 
 * Factors:
 * - Data completeness (40%): How many fields are populated
 * - Source reliability (30%): VERIFIED > MANUAL > GEMINI > LLAMA
 * - Verification status (20%): Admin verified or not
 * - Recency (10%): How fresh the data is
 */
function calculateConfidenceScore(enrichedData, source, isVerified = false) {
    // 1. Data Completeness (40%)
    const requiredFields = ['name', 'country', 'city', 'domain', 'tuition_estimate', 'acceptance_rate', 'rank'];
    const presentFields = requiredFields.filter(field =>
        enrichedData[field] &&
        enrichedData[field] !== null &&
        enrichedData[field] !== '' &&
        enrichedData[field] !== 0
    ).length;
    const completeness = presentFields / requiredFields.length;

    // 2. Source Reliability (30%)
    const sourceScores = {
        'VERIFIED': 1.0,
        'MANUAL': 0.85,
        'GEMINI': 0.75,
        'LLAMA': 0.65,
        'AI': 0.70
    };
    const sourceScore = sourceScores[source] || 0.5;

    // 3. Verification Status (20%)
    const verifiedScore = isVerified ? 1.0 : 0.0;

    // 4. Recency (10%) - New data gets full score
    const recencyScore = 1.0;

    // Calculate weighted average
    const confidence = (
        (completeness * 0.4) +
        (sourceScore * 0.3) +
        (verifiedScore * 0.2) +
        (recencyScore * 0.1)
    );

    // Round to 2 decimal places and clamp to [0, 1]
    return Math.min(1.0, Math.max(0.0, Math.round(confidence * 100) / 100));
}

/**
 * Get cache statistics
 */
async function getCacheStats() {
    try {
        const { data: totalCount } = await supabase
            .from('enrichment_cache')
            .select('id', { count: 'exact', head: true });

        const { data: verifiedCount } = await supabase
            .from('enrichment_cache')
            .select('id', { count: 'exact', head: true })
            .eq('is_verified', true);

        const { data: recentCache } = await supabase
            .from('enrichment_cache')
            .select('access_count')
            .order('access_count', { ascending: false })
            .limit(10);

        const avgAccessCount = recentCache?.reduce((sum, item) => sum + item.access_count, 0) / (recentCache?.length || 1);

        return {
            total_cached: totalCount?.count || 0,
            verified_count: verifiedCount?.count || 0,
            average_access_count: Math.round(avgAccessCount)
        };
    } catch (err) {
        console.error('Cache stats error:', err);
        return { total_cached: 0, verified_count: 0, average_access_count: 0 };
    }
}

/**
 * Clear expired cache entries
 */
async function clearExpiredCache() {
    try {
        const cutoffDate = new Date(Date.now() - CACHE_TTL.VERIFIED);

        const { error } = await supabase
            .from('enrichment_cache')
            .delete()
            .eq('is_verified', false)
            .lt('created_at', cutoffDate.toISOString());

        if (error) throw error;

        console.log('Expired cache entries cleared');
    } catch (err) {
        console.error('Clear expired cache error:', err);
    }
}

module.exports = {
    getCachedEnrichment,
    setCachedEnrichment,
    updateCacheAccess,
    calculateConfidenceScore,
    getCacheStats,
    clearExpiredCache,
    CACHE_TTL
};
