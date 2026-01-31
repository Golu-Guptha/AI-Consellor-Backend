const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { GoogleGenerativeAI } = require('@google/generative-ai');

async function listModels() {
    const key = process.env.GEMINI_API_KEY;
    let output = `Using API Key: ${key ? key.substring(0, 5) + '...' : 'NONE'}\n`;

    if (!key) {
        fs.writeFileSync('test-output.txt', output + 'No API Key');
        return;
    }

    try {
        const genAI = new GoogleGenerativeAI(key);
        const candidates = [
            'gemini-2.0-flash-exp',      // Should work - last model on old SDK  
            'gemini-2.5-flash',          // Requires NEW SDK (@google/genai)
            'gemini-3-flash-preview',    // Requires NEW SDK (@google/genai)
            'gemini-1.5-flash',          // DEPRECATED
            'gemini-pro'                 // DEPRECATED
        ];

        for (const modelName of candidates) {
            output += `Testing ${modelName}... `;
            try {
                const model = genAI.getGenerativeModel({ model: modelName });
                const result = await model.generateContent('Hi');
                const response = await result.response;
                output += '✅ SUCCESS\n';
            } catch (error) {
                if (error.message.includes('404')) {
                    output += '❌ 404 Not Found\n';
                } else {
                    output += `❌ Error: ${error.message.split('\n')[0]}\n`;
                }
            }
        }
    } catch (error) {
        output += `Fatal Error: ${error.message}\n`;
    }

    fs.writeFileSync('test-output.txt', output);
    console.log('Test complete, check test-output.txt');
}

listModels();
