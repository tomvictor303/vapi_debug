require('dotenv').config();

const apiKey = process.env.VAPI_API_KEY;
const prefixes_to_exclude = ["telnyx_", "vaia_mail_", "webhook_"];

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

async function checkAsyncApiRequestTools() {
  try {
    if (!apiKey) {
      throw new Error('VAPI_API_KEY environment variable is required');
    }

    const allTools = await fetchTools();
    const asyncFalseApiRequestTools = allTools
      .filter(tool => tool.type === 'apiRequest' && tool.async === false)
      .sort((firstTool, secondTool) =>
        (firstTool.name || '').localeCompare(secondTool.name || '')
      );
    const unsetOrTrueApiRequestTools = allTools
      .filter(
        tool =>
          tool.type === 'apiRequest' &&
          (tool.async === undefined || tool.async === true)
      )
      .sort((firstTool, secondTool) =>
        (firstTool.name || '').localeCompare(secondTool.name || '')
      );
    const excludedTargetTools = unsetOrTrueApiRequestTools.filter(tool =>
      prefixes_to_exclude.some(prefix => (tool.name || '').startsWith(prefix))
    );
    const targetTools = unsetOrTrueApiRequestTools.filter(
      tool =>
        !prefixes_to_exclude.some(prefix => (tool.name || '').startsWith(prefix))
    );

    console.log(`\nTotal tools: ${allTools.length}`);
    console.log(
      `API request tools with async explicitly set to false: ${asyncFalseApiRequestTools.length}`
    );
    asyncFalseApiRequestTools.forEach(tool => {
      console.log(`- ${tool.name || '(unnamed tool)'}`);
    });
    console.log(
      `\nTarget API request tools with async unset or set to true: ${targetTools.length}`
    );
    targetTools.forEach(tool => {
      console.log(`- ${tool.name || '(unnamed tool)'}`);
    });

    console.log(
      `\nExcluded target tools (${prefixes_to_exclude.join(', ')}): ${excludedTargetTools.length}`
    );
    excludedTargetTools.forEach(tool => {
      console.log(`- ${tool.name || '(unnamed tool)'}`);
    });

    return { targetTools, excludedTargetTools };
  } catch (error) {
    console.error('Error:', error.message);
    return [];
  }
}

checkAsyncApiRequestTools();
