/**
 * Calculate acceptance likelihood score for a user-university match
 * Returns a score from 0-100 with breakdown
 * 
 * Weights:
 * - GPA: 40%
 * - Test Scores (GRE/GMAT/IELTS/TOEFL): 25%
 * - University Rank: 15%
 * - Budget Match: 10%
 * - SOP/Extras: 10%
 */
function calculateAcceptanceScore(profile, university) {
    let totalScore = 0;
    const breakdown = {};

    // 1. GPA Score (0-40 points)
    if (profile.gpa) {
        const gpaScore = Math.min((profile.gpa / 4.0) * 40, 40);
        totalScore += gpaScore;
        breakdown.gpa = {
            score: gpaScore,
            maxScore: 40,
            note: `GPA ${profile.gpa}/4.0`
        };
    } else {
        breakdown.gpa = { score: 0, maxScore: 40, note: 'GPA not provided' };
    }

    // 2. Test Scores (0-25 points)
    let testScore = 0;
    const testNotes = [];

    if (profile.gre_score) {
        // GRE: 260-340 scale, normalize to 25 points
        testScore = Math.max(((profile.gre_score - 260) / 80) * 25, 0);
        testNotes.push(`GRE ${profile.gre_score}`);
    } else if (profile.gmat_score) {
        // GMAT: 200-800 scale, normalize to 25 points
        testScore = Math.max(((profile.gmat_score - 200) / 600) * 25, 0);
        testNotes.push(`GMAT ${profile.gmat_score}`);
    }

    if (profile.ielts_score) {
        // IELTS: 0-9 scale, normalize to 25 points
        const ieltsScore = (profile.ielts_score / 9) * 25;
        testScore = Math.max(testScore, ieltsScore);
        testNotes.push(`IELTS ${profile.ielts_score}`);
    } else if (profile.toefl_score) {
        // TOEFL: 0-120 scale, normalize to 25 points
        const toeflScore = (profile.toefl_score / 120) * 25;
        testScore = Math.max(testScore, toeflScore);
        testNotes.push(`TOEFL ${profile.toefl_score}`);
    }

    totalScore += Math.min(testScore, 25);
    breakdown.testScores = {
        score: Math.min(testScore, 25),
        maxScore: 25,
        note: testNotes.length > 0 ? testNotes.join(', ') : 'No test scores provided'
    };

    // 3. University Rank Match (0-15 points)
    // Lower rank = better school = harder to get in
    // Inverse relationship
    if (university.rank) {
        let rankScore = 15;
        if (university.rank <= 50) rankScore = 5;  // Top 50: hard
        else if (university.rank <= 100) rankScore = 8;
        else if (university.rank <= 200) rankScore = 12;
        else rankScore = 15; // Easier

        totalScore += rankScore;
        breakdown.universityRank = {
            score: rankScore,
            maxScore: 15,
            note: `Rank #${university.rank}`
        };
    } else {
        breakdown.universityRank = {
            score: 8,
            maxScore: 15,
            note: 'Rank not available (assuming mid-tier)'
        };
        totalScore += 8;
    }

    // 4. Budget Match (0-10 points)
    if (university.tuition_estimate && profile.budget_max) {
        const budgetScore = university.tuition_estimate <= profile.budget_max ? 10 :
            university.tuition_estimate <= profile.budget_max * 1.2 ? 5 : 0;
        totalScore += budgetScore;
        breakdown.budget = {
            score: budgetScore,
            maxScore: 10,
            note: `Tuition $${university.tuition_estimate}/yr vs Budget $${profile.budget_max}/yr`
        };
    } else {
        breakdown.budget = {
            score: 5,
            maxScore: 10,
            note: 'Budget information incomplete'
        };
        totalScore += 5;
    }

    // 5. SOP & Extras (0-10 points)
    let sopScore = 0;
    if (profile.sop_status === 'READY') sopScore = 10;
    else if (profile.sop_status === 'DRAFT') sopScore = 5;
    else sopScore = 0;

    totalScore += sopScore;
    breakdown.sopAndExtras = {
        score: sopScore,
        maxScore: 10,
        note: `SOP: ${profile.sop_status || 'NOT_STARTED'}`
    };

    // Calculate category
    let category = 'TARGET';
    if (totalScore < 30) category = 'DREAM';
    else if (totalScore >= 30 && totalScore < 60) category = 'TARGET';
    else category = 'SAFE';

    return {
        totalScore: Math.round(totalScore),
        maxScore: 100,
        category,
        breakdown,
        interpretation: getInterpretation(totalScore)
    };
}

function getInterpretation(score) {
    if (score < 30) return 'Low acceptance likelihood (High Reach)';
    if (score < 45) return 'Below average acceptance likelihood (Reach)';
    if (score < 60) return 'Moderate acceptance likelihood (Target)';
    if (score < 75) return 'Good acceptance likelihood (Safe)';
    return 'High acceptance likelihood (Very Safe)';
}

/**
 * Calculate overall profile strength
 */
function calculateProfileStrength(profile) {
    const metrics = {
        academics: 0,
        exams: 0,
        sop: 0
    };

    // Academics (GPA)
    if (profile.gpa) {
        metrics.academics = Math.min((profile.gpa / 4.0) * 100, 100);
    }

    // Exams
    let examScore = 0;
    if (profile.gre_score) {
        examScore = Math.max(((profile.gre_score - 260) / 80) * 100, 0);
    } else if (profile.gmat_score) {
        examScore = Math.max(((profile.gmat_score - 200) / 600) * 100, 0);
    }

    if (profile.ielts_score || profile.toefl_score) {
        const englishScore = profile.ielts_score
            ? (profile.ielts_score / 9) * 100
            : (profile.toefl_score / 120) * 100;
        examScore = (examScore + englishScore) / 2;
    }

    metrics.exams = Math.min(examScore, 100);

    // SOP
    if (profile.sop_status === 'READY') metrics.sop = 100;
    else if (profile.sop_status === 'DRAFT') metrics.sop = 50;
    else metrics.sop = 0;

    const overall = (metrics.academics + metrics.exams + metrics.sop) / 3;

    return {
        overall: Math.round(overall),
        metrics: {
            academics: Math.round(metrics.academics),
            exams: Math.round(metrics.exams),
            sop: Math.round(metrics.sop)
        }
    };
}

module.exports = {
    calculateAcceptanceScore,
    calculateProfileStrength
};
