require('dotenv').config();

const assistantId = process.env.ASSISTANT_ID;
const apiKey = process.env.VAPI_API_KEY;

async function fetchAssistant() {
  try {
    if (!assistantId) {
      throw new Error('ASSISTANT_ID environment variable is required');
    }
    
    if (!apiKey) {
      throw new Error('VAPI_API_KEY environment variable is required');
    }

    const url = `https://api.vapi.ai/assistant/${assistantId}`;
    console.log(`Fetching assistant from: ${url}`);
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    console.log('\nResponse:');
    console.log(JSON.stringify(data, null, 2));
    
    const toolIds = data.model?.toolIds;
    console.log('\nTool IDs:');
    console.log(toolIds);
  } catch (error) {
    console.error('Error fetching assistant:', error.message);
  }
}

fetchAssistant();

