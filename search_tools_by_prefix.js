require('dotenv').config();
const readline = require('node:readline/promises');
const { stdin: input, stdout: output } = require('node:process');

const apiKey = process.env.VAPI_API_KEY;

async function promptForPrefix() {
  const rl = readline.createInterface({ input, output });

  try {
    const answer = await rl.question('Tool name prefix to search: ');
    return answer.trim();
  } finally {
    rl.close();
  }
}

function validatePrefix(prefix) {
  if (prefix.length <= 2) {
    throw new Error('Guardrail failed: prefix must be more than 2 letters');
  }
}

async function fetchTools() {
  const toolsUrl = 'https://api.vapi.ai/tool?limit=1000';
  console.log(`Fetching all tools from: ${toolsUrl}`);

  const response = await fetch(toolsUrl, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  return response.json();
}

async function searchToolsByPrefix() {
  try {
    if (!apiKey) {
      throw new Error('VAPI_API_KEY environment variable is required');
    }

    const prefix = await promptForPrefix();
    validatePrefix(prefix);

    const allTools = await fetchTools();
    const targetTools = allTools.filter(tool =>
      typeof tool.name === 'string' &&
      tool.name.startsWith(prefix)
    );

    console.log(`\nTools found for "${prefix}": ${targetTools.length}`);
    targetTools.forEach(tool => {
      console.log(`- ${tool.name} (${tool.id}): ${tool.url || '(no current URL)'}`);
    });

    return targetTools;
  } catch (error) {
    console.error('Error:', error.message);
    return [];
  }
}

searchToolsByPrefix();
