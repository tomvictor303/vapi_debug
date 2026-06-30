require('dotenv').config();
const readline = require('node:readline/promises');
const { stdin: input, stdout: output } = require('node:process');

const apiKey = process.env.VAPI_API_KEY;
const replaceMap = {
  quore_getHKWhen_tool: 'https://vsrvaiaapi.com/api/quore/getHKWhen',
  quore_getServiceRequestsByAreaName_tool: 'https://vsrvaiaapi.com/api/quore/getServiceRequestsByAreaName',
  quore_getHKWhere_tool: 'https://vsrvaiaapi.com/api/quore/getHKWhere',
  quore_addComplaint_tool: 'https://vsrvaiaapi.com/api/quore/addComplaint',
  quore_getComplaintReasons_tool: 'https://vsrvaiaapi.com/api/quore/getComplaintReasons',
  quore_getAreaItemsByAreaName_tool: 'https://vsrvaiaapi.com/api/quore/getAreaItemsByAreaName',
  quore_getIssueTypes_tool: 'https://vsrvaiaapi.com/api/quore/getIssueTypes',
  quore_addWorkOrder_tool: 'https://vsrvaiaapi.com/api/quore/addWorkOrder',
  quore_addServiceRequestByAreaName_tool: 'https://vsrvaiaapi.com/api/quore/addServiceRequestByAreaName',
  quore_getHKItems_tool: 'https://vsrvaiaapi.com/api/quore/getHKItems',
  quore_getAreas_tool: 'https://vsrvaiaapi.com/api/quore/getAreas',
};

function validateGuardrails() {
  const entries = Object.entries(replaceMap);

  if (entries.length === 0) {
    throw new Error('Guardrail failed: replaceMap must include at least one tool');
  }

  entries.forEach(([toolName, url]) => {
    if (!toolName.endsWith('_tool')) {
      throw new Error(`Guardrail failed: tool name must end with "_tool": ${toolName}`);
    }

    if (typeof url !== 'string' || !url.startsWith('https://')) {
      throw new Error(`Guardrail failed: invalid replacement URL for ${toolName}`);
    }
  });
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

async function patchToolUrl(tool, url) {
  const toolUrl = `https://api.vapi.ai/tool/${tool.id}`;

  const response = await fetch(toolUrl, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      url,
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to patch ${tool.name} (${tool.id}). HTTP status: ${response.status}`);
  }

  return response.json();
}

async function replaceToolUrls() {
  try {
    validateGuardrails();

    if (!apiKey) {
      throw new Error('VAPI_API_KEY environment variable is required');
    }

    const replaceNames = Object.keys(replaceMap);
    const confirmed = await confirmAction(
      `Are you sure to replace URLs for ${replaceNames.length} Vapi tools from replaceMap?`
    );
    if (!confirmed) {
      console.log('Cancelled. No Vapi tools were fetched or changed.');
      return [];
    }

    const allTools = await fetchTools();
    const toolByName = new Map(allTools.map(tool => [tool.name, tool]));
    const targetTools = replaceNames
      .map(name => toolByName.get(name))
      .filter(tool => tool !== undefined);
    const missingToolNames = replaceNames.filter(name => !toolByName.has(name));

    console.log(`\nTarget tools found: ${targetTools.length}`);
    targetTools.forEach(tool => {
      console.log(`- ${tool.name}: ${tool.url || '(no current URL)'} -> ${replaceMap[tool.name]}`);
    });

    if (missingToolNames.length > 0) {
      console.log('\nMissing tools from replaceMap:');
      missingToolNames.forEach(name => {
        console.log(`- ${name}`);
      });
    }

    if (targetTools.length === 0) {
      throw new Error('No tools found from replaceMap');
    }

    const modifyConfirmed = await confirmAction('Are you sure you want to modify these tool URLs?');
    if (!modifyConfirmed) {
      console.log('Cancelled. No Vapi tools were changed.');
      return targetTools;
    }

    for (const tool of targetTools) {
      const replacementUrl = replaceMap[tool.name];

      if (tool.url === replacementUrl) {
        console.log(`Skipped ${tool.name}: URL is already correct.`);
        continue;
      }

      await patchToolUrl(tool, replacementUrl);
      console.log(`Patched ${tool.name}: ${tool.url || '(no previous URL)'} -> ${replacementUrl}`);
    }

    return targetTools;
  } catch (error) {
    console.error('Error:', error.message);
    return [];
  }
}

replaceToolUrls();
