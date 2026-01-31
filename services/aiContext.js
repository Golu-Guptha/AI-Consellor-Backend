const supabase = require('../database/supabase');
const { getRecentActivities } = require('./activityTracker');

/**
 * Build comprehensive user context for AI
 * Includes profile, locks, shortlist, tasks, and recent activities
 */
async function buildUserContext(userId) {
    try {
        // Fetch all user data in parallel
        const [profileRes, locksRes, shortlistRes, tasksRes, activities] = await Promise.all([
            supabase.from('profiles').select('*').eq('user_id', userId).single(),
            supabase.from('university_locks').select('*, university:universities(*)').eq('user_id', userId).is('unlocked_at', null),
            supabase.from('user_shortlists').select('*, university:universities(*)').eq('user_id', userId),
            supabase.from('tasks').select('*').eq('user_id', userId),
            getRecentActivities(userId, 20)
        ]);

        const profile = profileRes.data || {};
        const locks = locksRes.data || [];
        const shortlist = shortlistRes.data || [];
        const tasks = tasksRes.data || [];

        // Calculate stage
        const stage = calculateStage(profile, locks, tasks);

        // Analyze profile strength
        const profileStrength = analyzeProfileStrength(profile);

        // Calculate momentum
        const momentum = calculateMomentum(activities);

        return {
            profile,
            locks,
            shortlist,
            tasks,
            activities,
            stage,
            profileStrength,
            gaps: identifyProfileGaps(profile),
            momentum
        };
    } catch (error) {
        console.error('Error building user context:', error);
        return {
            profile: {},
            locks: [],
            shortlist: [],
            tasks: [],
            activities: [],
            stage: 1,
            profileStrength: { strengths: [], weaknesses: [], score: 0 },
            gaps: [],
            momentum: { actionsThisWeek: 0, lastAction: null, momentum: 'LOW' }
        };
    }
}

/**
 * Analyze profile strengths and weaknesses
 */
function analyzeProfileStrength(profile) {
    const strengths = [];
    const weaknesses = [];
    let score = 0;

    // GPA Analysis (20 points)
    if (profile.gpa) {
        if (profile.gpa >= 3.7) {
            strengths.push("Strong GPA (3.7+)");
            score += 20;
        } else if (profile.gpa >= 3.3) {
            strengths.push("Good GPA (3.3-3.7)");
            score += 15;
        } else if (profile.gpa >= 3.0) {
            score += 10;
        } else {
            weaknesses.push("Low GPA (< 3.0)");
            score += 5;
        }
    } else {
        weaknesses.push("GPA not provided");
    }

    // GRE Score (20 points)
    if (profile.gre_score) {
        if (profile.gre_score >= 320) {
            strengths.push("Excellent GRE (320+)");
            score += 20;
        } else if (profile.gre_score >= 310) {
            strengths.push("Good GRE (310-320)");
            score += 15;
        } else {
            score += 10;
        }
    } else if (profile.target_degree === 'Masters' || profile.target_degree === 'PhD') {
        weaknesses.push("GRE score missing");
    }

    // English Test (20 points)
    if (profile.ielts_score) {
        if (profile.ielts_score >= 7.5) {
            strengths.push("Excellent IELTS (7.5+)");
            score += 20;
        } else if (profile.ielts_score >= 6.5) {
            score += 15;
        }
    } else if (profile.toefl_score) {
        if (profile.toefl_score >= 100) {
            strengths.push("Excellent TOEFL (100+)");
            score += 20;
        } else if (profile.toefl_score >= 90) {
            score += 15;
        }
    } else {
        weaknesses.push("English proficiency test missing");
    }

    // Profile Completeness (20 points)
    if (profile.profile_complete) {
        score += 20;
    } else {
        weaknesses.push("Profile incomplete");
    }

    // SOP Status (10 points)
    if (profile.sop_status === 'READY') {
        strengths.push("SOP ready");
        score += 10;
    } else if (profile.sop_status === 'DRAFT') {
        score += 5;
    } else {
        weaknesses.push("SOP not started");
    }

    // Budget Planning (10 points)
    if (profile.budget_max && profile.funding_plan) {
        strengths.push("Clear budget plan");
        score += 10;
    } else {
        weaknesses.push("Budget plan unclear");
    }

    return { strengths, weaknesses, score };
}

/**
 * Identify critical gaps in user's profile
 */
function identifyProfileGaps(profile) {
    const gaps = [];

    if (!profile.profile_complete) {
        gaps.push({ type: 'CRITICAL', message: 'Complete your profile first' });
    }

    if (!profile.ielts_score && !profile.toefl_score) {
        gaps.push({ type: 'CRITICAL', message: 'Take IELTS or TOEFL test' });
    }

    if ((profile.target_degree === 'Masters' || profile.target_degree === 'PhD') && !profile.gre_score) {
        gaps.push({ type: 'IMPORTANT', message: 'Consider taking GRE for better chances' });
    }

    if (profile.sop_status === 'NOT_STARTED') {
        gaps.push({ type: 'IMPORTANT', message: 'Start drafting your SOP' });
    }

    if (!profile.budget_max) {
        gaps.push({ type: 'PLANNING', message: 'Define your budget range' });
    }

    return gaps;
}

/**
 * Calculate user's current stage
 */
function calculateStage(profile, locks, tasks) {
    if (!profile.profile_complete) return 1; // Building Profile
    if (locks.length === 0) return 2; // Discovering/Finalizing Universities

    // Check if all tasks are completed
    const incompleteTasks = tasks.filter(t => t.status !== 'DONE');
    if (tasks.length > 0 && incompleteTasks.length === 0) {
        return 5; // All applications complete
    }

    return 4; // Preparing Applications
}

/**
 * Calculate user momentum/activity level
 */
function calculateMomentum(activities) {
    const today = new Date();
    const lastWeek = activities.filter(a => {
        const activityDate = new Date(a.created_at);
        const daysDiff = (today - activityDate) / (1000 * 60 * 60 * 24);
        return daysDiff <= 7;
    });

    const actionsThisWeek = lastWeek.length;
    const lastAction = activities[0] || null;

    let momentum = 'LOW';
    if (actionsThisWeek > 5) momentum = 'HIGH';
    else if (actionsThisWeek > 2) momentum = 'MEDIUM';

    return {
        actionsThisWeek,
        lastAction,
        momentum
    };
}

/**
 * Categorize university as DREAM/TARGET/SAFE
 * Based on user's profile vs university requirements
 */
function categorizeUniversity(university, userProfile) {
    let acceptanceScore = 50; // Base score

    // GPA matching
    if (university.avg_gpa && userProfile.gpa) {
        if (userProfile.gpa >= university.avg_gpa + 0.3) {
            acceptanceScore += 20;
        } else if (userProfile.gpa >= university.avg_gpa) {
            acceptanceScore += 10;
        } else if (userProfile.gpa < university.avg_gpa - 0.3) {
            acceptanceScore -= 20;
        } else {
            acceptanceScore -= 10;
        }
    }

    // Test scores
    if (userProfile.gre_score) {
        if (userProfile.gre_score >= 320) acceptanceScore += 10;
        else if (userProfile.gre_score < 300) acceptanceScore -= 10;
    }

    // Budget fit
    if (university.tuition_estimate && userProfile.budget_max) {
        if (university.tuition_estimate <= userProfile.budget_max) {
            acceptanceScore += 10;
        } else {
            acceptanceScore -= 15; // Over budget is risky
        }
    }

    // Determine category
    if (acceptanceScore >= 70) return 'SAFE';
    if (acceptanceScore >= 40) return 'TARGET';
    return 'DREAM';
}

/**
 * Generate recommendation reasoning
 */
function generateRecommendationReason(university, userProfile, category, acceptanceScore) {
    const reasons = [];
    const risks = [];
    const strengths = [];

    // GPA comparison
    if (university.avg_gpa && userProfile.gpa) {
        const diff = userProfile.gpa - university.avg_gpa;
        if (diff >= 0.3) {
            strengths.push(`Your GPA (${userProfile.gpa}) exceeds their average`);
        } else if (diff >= 0) {
            strengths.push(`GPA matches well`);
        } else if (diff >= -0.3) {
            risks.push(`Your GPA slightly below average`);
        } else {
            risks.push(`GPA significantly below average`);
        }
    }

    // Program fit
    if (!university.programs || university.programs.includes(userProfile.field_of_study)) {
        strengths.push(`Strong program in ${userProfile.field_of_study}`);
    }

    // Budget
    if (university.tuition_estimate && userProfile.budget_max) {
        if (university.tuition_estimate <= userProfile.budget_max * 0.8) {
            strengths.push("Well within budget");
        } else if (university.tuition_estimate <= userProfile.budget_max) {
            strengths.push("Within budget");
        } else {
            risks.push(`Above budget by $${(university.tuition_estimate - userProfile.budget_max).toLocaleString()}`);
        }
    }

    // Category-specific reasoning
    if (category === 'DREAM') {
        risks.push("Highly competitive - low acceptance rate");
    } else if (category === 'SAFE') {
        strengths.push("Strong acceptance likelihood");
    }

    const reasoning = `${category} school with ${acceptanceScore}% estimated acceptance chance. ${reasons.join('; ')}`;

    return { reasoning, risks, strengths };
}

module.exports = {
    buildUserContext,
    analyzeProfileStrength,
    identifyProfileGaps,
    calculateStage,
    calculateMomentum,
    categorizeUniversity,
    generateRecommendationReason
};
