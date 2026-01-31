require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');

const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey) {
    console.error('❌ GEMINI_API_KEY not found in .env');
    process.exit(1);
}

console.log(`🔑 Using API Key: ${apiKey.substring(0, 5)}...`);

async function listModels() {
    try {
        const genAI = new GoogleGenerativeAI(apiKey);
        // Note: listModels is on the genAI instance or model manager depending on SDK version
        // In @google/generative-ai, we might not have direct listModels on the main class in all versions
        // But usually it is exposed via the API.
        // Let's try to infer from error message or just try standard ones.

        console.log('\n🔍 Testing standard model names...');

        const modelsToTest = [
            'gemini-1.5-flash',
            'gemini-1.5-flash-latest',
            'gemini-1.5-flash-001',
            'gemini-1.5-pro',
            'gemini-pro',
            'gemini-pro-vision'
        ];

        for (const modelName of modelsToTest) {
            console.log(`\nTesting model: ${modelName}...`);
            try {
                const model = genAI.getGenerativeModel({ model: modelName });
                const result = await model.generateContent("Hello, are you working?");
                const response = await result.response;
                console.log(`✅ SUCCESS! ${modelName} is working.`);
                console.log(`Response: ${response.text()}`);
                process.exit(0); // Exit on first success to save time
            } catch (error) {
                console.log(`❌ Failed: ${modelName}`);
                if (error.message.includes('404')) {
                    console.log('   Reason: Model not found (404)');
                } else {
                    console.log(`   Reason: ${error.message}`);
                }
            }
        }

    } catch (error) {
        console.error('Fatal Error:', error);
    }
}

listModels();
