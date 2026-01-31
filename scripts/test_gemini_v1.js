require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');

const apiKey = process.env.GEMINI_API_KEY;

console.log(`🔑 Testing Gemini with explicit API version...`);

async function testWithVersion() {
    try {
        // Try to force v1 via custom fetch or configuration if supported?
        // Actually, the SDK doesn't easily expose version change in constructor in all versions.
        // But we can try the model string "models/gemini-1.5-flash"

        const genAI = new GoogleGenerativeAI(apiKey);

        // Try getting model with full path
        console.log("Testing 'models/gemini-1.5-flash'...");
        try {
            const model = genAI.getGenerativeModel({ model: "models/gemini-1.5-flash" });
            const result = await model.generateContent("Hello");
            console.log("✅ SUCCESS with 'models/gemini-1.5-flash'");
            return;
        } catch (e) {
            console.log("❌ Failed:", e.message);
        }

        // Try 'gemini-1.0-pro'
        console.log("Testing 'gemini-1.0-pro'...");
        try {
            const model = genAI.getGenerativeModel({ model: "gemini-1.0-pro" });
            const result = await model.generateContent("Hello");
            console.log("✅ SUCCESS with 'gemini-1.0-pro'");
            return;
        } catch (e) {
            console.log("❌ Failed:", e.message);
        }

    } catch (error) {
        console.error('Fatal Error:', error);
    }
}

testWithVersion();
