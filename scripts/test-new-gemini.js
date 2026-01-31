const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { GoogleGenAI } = require('@google/genai');

async function testGemini() {
    const key = process.env.GEMINI_API_KEY;
    let output = `Testing Gemini 2.5 Flash with NEW SDK\nUsing API Key: ${key ? key.substring(0, 5) + '...' : 'NONE'}\n\n`;

    if (!key) {
        fs.writeFileSync('test-output.txt', output + 'No API Key');
        console.log('No API Key found');
        return;
    }

    try {
        const ai = new GoogleGenAI({ apiKey: key });

        output += 'Testing gemini-2.5-flash... ';
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: 'Say "Hello, I am Gemini 2.5 Flash!" in JSON format: {"message": "..."}'
        });

        output += '✅ SUCCESS\n';
        output += `Response: ${response.text}\n`;

    } catch (error) {
        output += `❌ Error: ${error.message}\n`;
    }

    fs.writeFileSync('test-output.txt', output);
    console.log(output);
}

testGemini();
