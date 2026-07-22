require('dotenv').config();
const fs = require('node:fs/promises');
const path = require('node:path');

const apiKey = process.env.VAPI_API_KEY;

function createBackupFilePath() {
  const timestamp = new Date().toISOString().replace(/[-:.]/g, '');
  return path.join(
    __dirname,
    'backup',
    `bku_all_api_request_tools_${timestamp}.json`
  );
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

  const tools = await response.json();

  if (!Array.isArray(tools)) {
    throw new Error('Unexpected API response: expected an array of tools');
  }

  return tools;
}

async function backupAllApiRequestTools() {
  try {
    if (!apiKey) {
      throw new Error('VAPI_API_KEY environment variable is required');
    }

    const allTools = await fetchTools();
    const apiRequestTools = allTools.filter(tool => tool.type === 'apiRequest');
    const backupFilePath = createBackupFilePath();

    await fs.mkdir(path.dirname(backupFilePath), { recursive: true });
    await fs.writeFile(
      backupFilePath,
      `${JSON.stringify(apiRequestTools, null, 2)}\n`,
      'utf8'
    );

    console.log(`Total tools fetched: ${allTools.length}`);
    console.log(`API request tools backed up: ${apiRequestTools.length}`);
    console.log(`Backup saved to: ${backupFilePath}`);
  } catch (error) {
    console.error('Error:', error.message);
    process.exitCode = 1;
  }
}

backupAllApiRequestTools();
