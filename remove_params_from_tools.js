require('dotenv').config();
const readline = require('node:readline/promises');
const { stdin: input, stdout: output } = require('node:process');

const apiKey = process.env.VAPI_API_KEY;
const filter_prefix = 'stayntouch_';
const params_to_remove = ['hotel_id', 'isProduction'];

/**
 * Validates destructive-action guardrails before any Vapi tools are fetched or
 * changed.
 */
function validateGuardrails() {
  if (!filter_prefix.endsWith('_')) {
    throw new Error('Guardrail failed: filter_prefix must end with "_"');
  }

  if (filter_prefix.length < 5) {
    throw new Error('Guardrail failed: filter_prefix must be at least 5 characters');
  }
}

/**
 * Asks the user to confirm an operation.
 *
 * @param {string} message Confirmation message to show.
 * @returns {Promise<boolean>} Whether the user confirmed the operation.
 */
async function confirmAction(message) {
  const rl = readline.createInterface({ input, output });

  try {
    const answer = await rl.question(`${message} Type y/n: `);

    return answer.trim().toLowerCase() === 'y';
  } finally {
    rl.close();
  }
}

/**
 * Removes configured params from a tool body schema.
 *
 * @param {object} body Tool body schema.
 * @returns {{ body: object, removedParams2Log: string[] }} Updated body and removed params to log.
 */
function removeParamsFromBody(body) {
  const updatedBody = structuredClone(body || {});
  const removedParams2Log = [];

  if (Array.isArray(updatedBody.required)) {
    const requiredParams = new Set(updatedBody.required);
    updatedBody.required = updatedBody.required.filter(param => !params_to_remove.includes(param));

    params_to_remove.forEach(param => {
      if (requiredParams.has(param)) {
        removedParams2Log.push(param);
      }
    });
  }

  if (updatedBody.properties && typeof updatedBody.properties === 'object') {
    params_to_remove.forEach(param => {
      if (Object.hasOwn(updatedBody.properties, param)) {
        delete updatedBody.properties[param];

        if (!removedParams2Log.includes(param)) {
          removedParams2Log.push(param);
        }
      }
    });
  }

  return { body: updatedBody, removedParams2Log };
}

/**
 * Patches a Vapi tool with an updated body schema.
 *
 * @param {object} tool Target Vapi tool.
 * @param {object} body Updated tool body schema.
 * @returns {Promise<object>} Updated Vapi tool response.
 */
async function patchTool(tool, body) {
  const toolUrl = `https://api.vapi.ai/tool/${tool.id}`;

  const response = await fetch(toolUrl, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      body
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to patch ${tool.name} (${tool.id}). HTTP status: ${response.status}`);
  }

  return response.json();
}

/**
 * Fetches all Vapi tools and collects tools whose names start with the
 * configured prefix.
 */
async function collectTargetTools() {
  try {
    validateGuardrails();

    if (!apiKey) {
      throw new Error('VAPI_API_KEY environment variable is required');
    }

    const confirmed = await confirmAction(
      `Are you sure to remove ${params_to_remove.join(', ')} parameters from Vapi tools starting with "${filter_prefix}"?`
    );
    if (!confirmed) {
      console.log('Cancelled. No Vapi tools were fetched or changed.');
      return [];
    }

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

    const allTools = await response.json();
    const targetTools = allTools.filter(tool =>
      tool.type === 'apiRequest' &&
      typeof tool.name === 'string' &&
      tool.name.startsWith(filter_prefix)
    );

    if (targetTools.length === 0) {
      throw new Error(`No apiRequest tools found starting with "${filter_prefix}"`);
    }

    console.log(`\nTarget tools found: ${targetTools.length}`);
    targetTools.forEach(tool => {
      console.log(`- ${tool.name}`);
    });

    const modifyConfirmed = await confirmAction('Are you sure you want to modify these tools?');
    if (!modifyConfirmed) {
      console.log('Cancelled. No Vapi tools were changed.');
      return targetTools;
    }

    for (const tool of targetTools) {
      const { body, removedParams2Log } = removeParamsFromBody(tool.body);

      if (removedParams2Log.length === 0) {
        console.log(`Skipped ${tool.name}: no matching params found.`);
        continue;
      }

      await patchTool(tool, body);
      console.log(`Patched ${tool.name}: removed ${removedParams2Log.join(', ')}.`);
    }

    return targetTools;
  } catch (error) {
    console.error('Error:', error.message);
    return [];
  }
}

collectTargetTools();
