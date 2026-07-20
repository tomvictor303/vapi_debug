require('dotenv').config();

const readline = require('node:readline/promises');
const { stdin: input, stdout: output } = require('node:process');

const API_URL = 'https://api.vapi.ai/call';
const CALL_LIMIT = 500;
const HOUR_MS = 60 * 60 * 1000;
const CHUNK_LEVELS_MS = [12 * HOUR_MS, 6 * HOUR_MS, 2 * HOUR_MS];

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
  return calls;
}

async function fetchAdaptiveCallChunk({
  assistantId,
  chunkStart,
  chunkEnd,
  apiKey,
  level = 0,
}) {
  const calls = await fetchCallChunk({
    assistantId,
    createdAtGe: new Date(chunkStart).toISOString(),
    createdAtLe: new Date(chunkEnd).toISOString(),
    apiKey,
  });

  if (calls.length < CALL_LIMIT) return calls;

  if (level === CHUNK_LEVELS_MS.length - 1) {
    console.warn(
      `Warning: 2-hour block ${new Date(chunkStart).toISOString()} through ` +
      `${new Date(chunkEnd).toISOString()} reached the ${CALL_LIMIT}-call limit and may be incomplete.`
    );
    return calls;
  }

  const nextLevel = level + 1;
  const nextDuration = CHUNK_LEVELS_MS[nextLevel];
  const nextDurationHours = nextDuration / HOUR_MS;
  console.log(
    `Chunk reached the ${CALL_LIMIT}-call limit; retrying it in ${nextDurationHours}-hour blocks...`
  );

  const detailedCalls = [];
  for (
    let detailedStart = chunkStart;
    detailedStart <= chunkEnd;
    detailedStart += nextDuration
  ) {
    const detailedEnd = Math.min(detailedStart + nextDuration - 1, chunkEnd);
    const blockCalls = await fetchAdaptiveCallChunk({
      assistantId,
      chunkStart: detailedStart,
      chunkEnd: detailedEnd,
      apiKey,
      level: nextLevel,
    });
    detailedCalls.push(...blockCalls);
  }

  return detailedCalls;
}

async function fetchCalls({ assistantId, createdAtGe, createdAtLe }) {
  const apiKey = process.env.VAPI_API_KEY?.trim();
  if (!apiKey) throw new Error('VAPI_API_KEY environment variable is required');

  const rangeStart = new Date(`${createdAtGe}T00:00:00.000Z`).getTime();
  const rangeEnd = new Date(`${createdAtLe}T23:59:59.999Z`).getTime();
  const callsById = new Map();

  for (
    let chunkStart = rangeStart;
    chunkStart <= rangeEnd;
    chunkStart += CHUNK_LEVELS_MS[0]
  ) {
    const chunkEnd = Math.min(chunkStart + CHUNK_LEVELS_MS[0] - 1, rangeEnd);
    const calls = await fetchAdaptiveCallChunk({
      assistantId,
      chunkStart,
      chunkEnd,
      apiKey,
    });

    calls.forEach(call => {
      if (typeof call?.id === 'string' && call.id.length > 0) {
        callsById.set(call.id, call);
      }
    });
  }

  return [...callsById.values()];
}

function findMatchingToolCalls(call, toolNamePrefix) {
  if (!Array.isArray(call?.messages)) return [];

  const matches = [];
  call.messages.forEach((message, messageIndex) => {
    if (message?.role !== 'tool_calls' || !Array.isArray(message.toolCalls)) return;

    message.toolCalls.forEach((toolCall, toolCallIndex) => {
      const toolName = toolCall?.function?.name;
      if (typeof toolName === 'string' && toolName.startsWith(toolNamePrefix)) {
        matches.push({ messageIndex, toolCallIndex, toolName, toolCall });
      }
    });
  });

  return matches;
}

function formatLocalCallTime(call) {
  const timestamp = call?.startedAt || call?.createdAt;
  if (!timestamp) return '(start time unavailable)';

  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return `(invalid start time: ${timestamp})`;

  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short',
  });
}

function inspectCallsForToolPrefix(calls, toolNamePrefix) {
  const matchedCalls = [];

  for (const [index, call] of calls.entries()) {
    const callId = call.id;
    const startTime = formatLocalCallTime(call);
    console.log(`Inspecting call ${index + 1}/${calls.length}: ${callId}`);
    console.log(`  Start time (local): ${startTime}`);

    const matches = findMatchingToolCalls(call, toolNamePrefix);
    if (matches.length > 0) matchedCalls.push({ callId, startTime, matches });
  }

  return matchedCalls;
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
  const calls = await fetchCalls({ assistantId, createdAtGe, createdAtLe });
  const callIds = calls.map(call => call.id);

  console.log(`\nFound ${callIds.length} call ID(s) for assistant ${assistantId}.`);
  console.log(`Tool-name prefix for the next step: ${toolNamePrefix}`);
  console.log('\nCall IDs:');
  callIds.forEach(id => console.log(id));

  const matchedCalls = inspectCallsForToolPrefix(calls, toolNamePrefix);
  const matchCount = matchedCalls.reduce((total, call) => total + call.matches.length, 0);

  console.log(`\nFound ${matchCount} matching tool call(s) in ${matchedCalls.length} call(s).`);
  matchedCalls.forEach(({ callId, startTime, matches }) => {
    console.log(`\nCall ${callId} - ${startTime}:`);
    matches.forEach(match => console.log(`- ${match.toolName}`));
  });

  return { callIds, toolNamePrefix, matchedCalls };
}

if (require.main === module) {
  main().catch(error => {
    console.error('Error:', error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  fetchAdaptiveCallChunk,
  fetchCallChunk,
  fetchCalls,
  findMatchingToolCalls,
  formatLocalCallTime,
  inspectCallsForToolPrefix,
  requireDate,
};
