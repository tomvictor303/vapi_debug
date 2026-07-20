require('dotenv').config();

const readline = require('node:readline/promises');
const { stdin: input, stdout: output } = require('node:process');

const API_URL = 'https://api.vapi.ai/call';
const CALL_LIMIT = 1000;
const CHUNK_DURATION_MS = 8 * 60 * 60 * 1000;

async function promptForToolNamePrefix() {
  const rl = readline.createInterface({ input, output });
  try {
    const toolNamePrefix = (await rl.question('Tool name prefix: ')).trim();
    if (!toolNamePrefix) throw new Error('Tool name prefix is required');
    return toolNamePrefix;
  } finally {
    rl.close();
  }
}

function requireDate(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} environment variable is required`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new Error(`${name} must be a valid date in YYYY-MM-DD format`);
  }
  return value;
}

async function fetchCallChunk({ assistantId, createdAtGe, createdAtLe, apiKey }) {
  const url = new URL(API_URL);
  url.search = new URLSearchParams({
    assistantId,
    createdAtGe,
    createdAtLe,
    limit: String(CALL_LIMIT),
  }).toString();

  console.log(`Fetching calls from ${createdAtGe} through ${createdAtLe}...`);
  const response = await fetch(url, {
    headers: { Accept: 'application/json', Authorization: `Bearer ${apiKey}` },
  });

  if (!response.ok) {
    const responseText = await response.text();
    throw new Error(
      `Vapi call request failed (${response.status} ${response.statusText})` +
      (responseText ? `: ${responseText}` : '')
    );
  }

  const calls = await response.json();
  if (!Array.isArray(calls)) {
    throw new Error('Unexpected Vapi response: expected an array of calls');
  }
  if (calls.length === CALL_LIMIT) {
    console.warn(`Warning: chunk reached the ${CALL_LIMIT}-call limit and may be incomplete.`);
  }

  return calls;
}

async function fetchCallIds({ assistantId, createdAtGe, createdAtLe }) {
  const apiKey = process.env.VAPI_API_KEY?.trim();
  if (!apiKey) throw new Error('VAPI_API_KEY environment variable is required');

  const rangeStart = new Date(`${createdAtGe}T00:00:00.000Z`).getTime();
  const rangeEnd = new Date(`${createdAtLe}T23:59:59.999Z`).getTime();
  const callIds = new Set();

  for (let chunkStart = rangeStart; chunkStart <= rangeEnd; chunkStart += CHUNK_DURATION_MS) {
    const chunkEnd = Math.min(chunkStart + CHUNK_DURATION_MS - 1, rangeEnd);
    const calls = await fetchCallChunk({
      assistantId,
      createdAtGe: new Date(chunkStart).toISOString(),
      createdAtLe: new Date(chunkEnd).toISOString(),
      apiKey,
    });

    calls.forEach(call => {
      if (typeof call?.id === 'string' && call.id.length > 0) callIds.add(call.id);
    });
  }

  return [...callIds];
}

async function main() {
  const assistantId = process.env.CALL_OF_ASSISTANT_ID?.trim();
  if (!assistantId) {
    throw new Error('CALL_OF_ASSISTANT_ID environment variable is required');
  }

  const createdAtGe = requireDate('CALL_CREATED_DATE_FROM');
  const createdAtLe = requireDate('CALL_CREATED_DATE_TO');
  if (createdAtGe > createdAtLe) {
    throw new Error('CALL_CREATED_DATE_FROM must not be after CALL_CREATED_DATE_TO');
  }

  const toolNamePrefix = await promptForToolNamePrefix();
  const callIds = await fetchCallIds({ assistantId, createdAtGe, createdAtLe });

  console.log(`\nFound ${callIds.length} call ID(s) for assistant ${assistantId}.`);
  console.log(`Tool-name prefix for the next step: ${toolNamePrefix}`);
  console.log('\nCall IDs:');
  callIds.forEach(id => console.log(id));
  return { callIds, toolNamePrefix };
}

if (require.main === module) {
  main().catch(error => {
    console.error('Error:', error.message);
    process.exitCode = 1;
  });
}

module.exports = { fetchCallIds, fetchCallChunk, requireDate };
