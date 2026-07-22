require('dotenv').config();
const readline = require('node:readline/promises');
const { stdin: input, stdout: output } = require('node:process');

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

async function confirmAction(message) {
  const rl = readline.createInterface({ input, output });

  try {
    const answer = await rl.question(`${message} Type y/n: `);
    return answer.trim().toLowerCase() === 'y';
  } finally {
    rl.close();
  }
}

async function promptForTargetPrefix() {
  const rl = readline.createInterface({ input, output });

  try {
    const answer = await rl.question(
      'Tool name prefix to patch (or type "all" to patch all eligible tools): '
    );
    const prefix = answer.trim();

    if (!prefix) {
      throw new Error('A tool name prefix or "all" is required');
    }

    return prefix;
  } finally {
    rl.close();
  }
}

async function setToolAsyncFalse(tool) {
  if (!tool.id) {
    throw new Error('Tool ID is missing');
  }

  const toolUrl = `https://api.vapi.ai/tool/${tool.id}`;
  const response = await fetch(toolUrl, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      async: false,
    }),
  });

  if (!response.ok) {
    throw new Error(`HTTP status: ${response.status}`);
  }
}

async function checkAsyncApiRequestTools() {
  try {
    if (!apiKey) {
      throw new Error('VAPI_API_KEY environment variable is required');
    }

    const targetPrefix = await promptForTargetPrefix();
    const patchAllEligibleTools = targetPrefix.toLowerCase() === 'all';
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
        !prefixes_to_exclude.some(prefix => (tool.name || '').startsWith(prefix)) &&
        (patchAllEligibleTools || (tool.name || '').startsWith(targetPrefix))
    );

    console.log(`\nTotal tools: ${allTools.length}`);
    console.log(
      `API request tools **already** with async explicitly set to false: ${asyncFalseApiRequestTools.length}`
    );
    asyncFalseApiRequestTools.forEach(tool => {
      console.log(`- ${tool.name || '(unnamed tool)'}`);
    });
    console.log(
      `\nTarget API request tools for "${targetPrefix}" with async unset or set to true: ${targetTools.length}`
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

    if (targetTools.length === 0) {
      console.log('\nNo target tools need to be updated.');
      return { targetTools, excludedTargetTools };
    }

    const confirmed = await confirmAction(
      `\nSet async to false for ${targetTools.length} target tools using PATCH?`
    );
    if (!confirmed) {
      console.log('Cancelled. No tools were changed.');
      return { targetTools, excludedTargetTools };
    }

    let updatedCount = 0;
    const failedTools = [];

    for (const tool of targetTools) {
      try {
        await setToolAsyncFalse(tool);
        updatedCount += 1;
        console.log(`Updated ${tool.name || '(unnamed tool)'} (${tool.id}): async = false`);
      } catch (error) {
        failedTools.push(tool);
        console.error(
          `Failed ${tool.name || '(unnamed tool)'} (${tool.id}): ${error.message}`
        );
      }
    }

    console.log(`\nUpdated tools: ${updatedCount}`);
    console.log(`Failed tools: ${failedTools.length}`);

    return { targetTools, excludedTargetTools, updatedCount, failedTools };
  } catch (error) {
    console.error('Error:', error.message);
    return [];
  }
}

checkAsyncApiRequestTools();
