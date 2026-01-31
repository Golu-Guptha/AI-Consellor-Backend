const supabase = require('../database/supabase');
const { getLLMResponse } = require('./aiService');

/**
 * Analyze university fit for a user using AI
 */
async function analyzeUniversityForUser(userId, universityId) {
  console.log(`🧠 Starting AI analysis for user ${userId}, university ${universityId}`);
  try {
    // 1. Fetch User Profile
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('*')
      .eq('user_id', userId)
      .single();

    // 2. Fetch University Data
    const { data: university } = await supabase
      .from('universities')
      .select('*')
      .eq('id', universityId)
      .single();

    if (!profile || !university) {
      console.error('❌ Analysis failed: missing data', { profile: !!profile, university: !!university });
      throw new Error('Profile or University not found');
    }

    console.log(`✅ Data fetched - Profile: ${profile.field_of_study || 'N/A'}, University: ${university.name}`);

    // 3. Construct Prompt
    const systemPrompt = `You are an expert university admissions counselor. Analyze the fit between this student and university.

STUDENT PROFILE:
- GPA: ${profile.gpa || 'N/A'}
- Field of Study: ${profile.field_of_study || 'N/A'}
- Degree: ${profile.degree_level || 'N/A'}
- Budget: $${profile.budget_max || 'N/A'}
- Test Scores: GRE ${profile.gre_score || 'N/A'}, IELTS ${profile.ielts_score || 'N/A'}, TOEFL ${profile.toefl_score || 'N/A'}
- Experience: ${profile.work_experience_years || 0} years

UNIVERSITY PROFILE:
- Name: ${university.name}
- Country: ${university.country}
- Rank: ${university.rank || 'N/A'}
- Tuition: $${university.tuition_estimate || 'N/A'}
- Acceptance Rate: ${university.acceptance_rate || 'N/A'}%
${university.detailed_info ? `\nDETAILED UNIVERSITY DATA:\n${JSON.stringify(university.detailed_info, null, 2)}` : ''}

Provide a personalized analysis in JSON format.
CRITICAL: Keep reasoning "medium length" - concise and direct (max 2-3 sentences per point). Avoid overly long paragraphs.

{
  "profile_fit": {
    "reasons": [
      "Medium detailed reason matching profile to university (max 2 sentences)",
      "Another medium detailed reason about program fit",
      "Third reason"
    ],
    "score": 0-100
  },
  "key_risks": {
    "reasons": [
      "Specific risk description (max 2 sentences)",
      "Academic or financial risk"
    ],
    "severity": "low|medium|high"
  },
  "acceptance_score": {
    "percentage": 0-100,
    "category": "DREAM|TARGET|SAFE",
    "reasoning": "Concise explanation of chance calculation"
  },
  "cost_analysis": {
    "level": "Low|Medium|High",
    "within_budget": true|false,
    "reasoning": "Brief budget breakdown"
  }
}
Be realistic and honest. If data is missing (e.g. N/A), make reasonable estimates based on general knowledge of the university but note that it's an estimate.`;

    // 4. Call AI
    console.log(`🤖 Calling AI for analysis of ${university.name}...`);
    const messages = [{ role: 'user', content: `Analyze fit for ${university.name}` }];
    // Use GEMINI for detailed shortlist analysis
    const response = await getLLMResponse(messages, systemPrompt, 'GEMINI');

    // 5. Parse Response
    let analysis;
    if (typeof response === 'string' || response.text) {
      const text = response.text || response;
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        analysis = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('Failed to parse AI analysis');
      }
    } else {
      analysis = response;
    }

    // 6. Update Database
    console.log(`💾 Saving AI analysis to database...`);
    const { error: updateError } = await supabase
      .from('user_shortlists')
      .update({
        ai_analysis: analysis,
        analyzed_at: new Date().toISOString()
      })
      .eq('user_id', userId)
      .eq('university_id', universityId);

    if (updateError) {
      console.error('❌ Failed to save AI analysis:', updateError);
      throw updateError;
    }

    console.log(`✅ AI analysis saved successfully!`);
    return analysis;

  } catch (error) {
    console.error('❌ Shortlist analysis failed:', error.message);
    console.error('Stack:', error.stack);
    return null; // Don't crash the request if analysis fails
  }
}

module.exports = { analyzeUniversityForUser };
