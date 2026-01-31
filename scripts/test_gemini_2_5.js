require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');

const apiKey = process.env.GEMINI_API_KEY;

console.log('🧪 Testing Gemini 2.5 Flash (Current Stable Model)...\n');

async function testCurrentModel() {
    try {
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

        console.log('📡 Sending test request to Gemini 2.5 Flash...');
        const result = await model.generateContent("Hello! Please respond with a brief greeting.");
        const response = await result.response;
        const text = response.text();

        console.log('✅ SUCCESS! Gemini 2.5 Flash is working perfectly!\n');
        console.log('Response:', text);
        console.log('\n🎉 You can now use "gemini-2.5-flash" in your application!');

    } catch (error) {
        console.error('❌ Error:', error.message);
        if (error.message.includes('404')) {
            console.log('\n💡 The model might not be available for your API key.');
            console.log('   Try these alternatives:');
            console.log('   - gemini-3-flash-preview (latest preview)');
            console.log('   - gemini-2.5-pro (more powerful)');
        }
    }
}

testCurrentModel();
