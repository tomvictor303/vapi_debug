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

function requireKeywords() {
  const keywords = (process.env.CALL_USER_MSG_SEARCH_KEYWORDS || '')
    .split(',')
    .map(keyword => keyword.trim())
    .filter(Boolean);

  if (keywords.length === 0) {
    throw new Error(
      'CALL_USER_MSG_SEARCH_KEYWORDS environment variable must contain at least one keyword'
    );
  }
  return keywords;
}

async function fetchCallChunk({ assistantId, createdAtGe, createdAtLe, apiKey }) {
  const url = new URL(API_URL);
  url.search = new URLSearchParams({
    assistantId,
    createdAtGe,
    createdAtLe,
    limit: String(CALL_LIMIT),
  }).toString();

  console.log(`Fetching & Analyzing calls from ${createdAtGe} through ${createdAtLe}...`);
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
  onCalls,
}) {
  const calls = await fetchCallChunk({
    assistantId,
    createdAtGe: new Date(chunkStart).toISOString(),
    createdAtLe: new Date(chunkEnd).toISOString(),
    apiKey,
  });

  if (calls.length < CALL_LIMIT) {
    await onCalls(calls);
    return;
  }

  if (level === CHUNK_LEVELS_MS.length - 1) {
    console.warn(
      `Warning: 2-hour block ${new Date(chunkStart).toISOString()} through ` +
      `${new Date(chunkEnd).toISOString()} reached the ${CALL_LIMIT}-call limit and may be incomplete.`
    );
    await onCalls(calls);
    return;
  }

  const nextLevel = level + 1;
  const nextDuration = CHUNK_LEVELS_MS[nextLevel];
  console.log(
    `Chunk reached the ${CALL_LIMIT}-call limit; retrying it in ` +
    `${nextDuration / HOUR_MS}-hour blocks...`
  );

  for (
    let detailedStart = chunkStart;
    detailedStart <= chunkEnd;
    detailedStart += nextDuration
  ) {
    const detailedEnd = Math.min(detailedStart + nextDuration - 1, chunkEnd);
    await fetchAdaptiveCallChunk({
      assistantId,
      chunkStart: detailedStart,
      chunkEnd: detailedEnd,
      apiKey,
      level: nextLevel,
      onCalls,
    });
  }
}

function findMatchingUserMessages(call, keywords) {
  if (!Array.isArray(call?.messages)) return [];

  const normalizedKeywords = keywords.map(keyword => keyword.toLocaleLowerCase());
  const matches = [];

  call.messages.forEach((message, messageIndex) => {
    if (message?.role !== 'user' || typeof message.message !== 'string') return;

    const normalizedMessage = message.message.toLocaleLowerCase();
    const matchedKeywords = keywords.filter(
      (_, keywordIndex) => normalizedMessage.includes(normalizedKeywords[keywordIndex])
    );

    if (matchedKeywords.length > 0) {
      matches.push({
        messageIndex,
        message: message.message,
        matchedKeywords,
      });
    }
  });

  return matches;
}

function findMatchingToolCalls(call, toolNamePrefix) {
  if (!Array.isArray(call?.messages)) return [];

  const matches = [];
  call.messages.forEach((message, messageIndex) => {
    if (message?.role !== 'tool_calls' || !Array.isArray(message.toolCalls)) return;

    message.toolCalls.forEach((toolCall, toolCallIndex) => {
      const toolName = toolCall?.function?.name;
      if (typeof toolName === 'string' && toolName.startsWith(toolNamePrefix)) {
        matches.push({ messageIndex, toolCallIndex, toolName });
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

async function scanCallChunks({
  assistantId,
  createdAtGe,
  createdAtLe,
  keywords,
  toolNamePrefix,
}) {
  const apiKey = process.env.VAPI_API_KEY?.trim();
  if (!apiKey) throw new Error('VAPI_API_KEY environment variable is required');

  const rangeStart = new Date(`${createdAtGe}T00:00:00.000Z`).getTime();
  const rangeEnd = new Date(`${createdAtLe}T23:59:59.999Z`).getTime();
  const matchedCalls = [];
  let inspectedCallCount = 0;

  const inspectChunk = calls => {
    for (const call of calls) {
      inspectedCallCount += 1;
      const userMessageMatches = findMatchingUserMessages(call, keywords);
      if (userMessageMatches.length === 0) continue;

      matchedCalls.push({
        callId: call.id,
        startTime: formatLocalCallTime(call),
        userMessageMatches,
        matchingToolCalls: findMatchingToolCalls(call, toolNamePrefix),
      });
    }
  };

  for (
    let chunkStart = rangeStart;
    chunkStart <= rangeEnd;
    chunkStart += CHUNK_LEVELS_MS[0]
  ) {
    const chunkEnd = Math.min(chunkStart + CHUNK_LEVELS_MS[0] - 1, rangeEnd);
    await fetchAdaptiveCallChunk({
      assistantId,
      chunkStart,
      chunkEnd,
      apiKey,
      onCalls: inspectChunk,
    });
  }

  return { inspectedCallCount, matchedCalls };
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

  const keywords = requireKeywords();
  const toolNamePrefix = await promptForToolNamePrefix();
  const { inspectedCallCount, matchedCalls } = await scanCallChunks({
    assistantId,
    createdAtGe,
    createdAtLe,
    keywords,
    toolNamePrefix,
  });

  const matchedMessageCount = matchedCalls.reduce(
    (total, call) => total + call.userMessageMatches.length,
    0
  );
  const callsWithMatchingTools = matchedCalls.filter(
    call => call.matchingToolCalls.length > 0
  ).length;

  console.log(`\nInspected ${inspectedCallCount} call(s).`);
  console.log(
    `Found ${matchedMessageCount} matching user message(s) in ${matchedCalls.length} call(s).`
  );
  console.log(
    `${callsWithMatchingTools} of those call(s) called a "${toolNamePrefix}" tool.`
  );

  console.log('\nMatched conversations:');
  matchedCalls.forEach(({ callId, startTime, userMessageMatches, matchingToolCalls }) => {
    const toolResult = matchingToolCalls.length === 0
      ? 'No'
      : `Yes (${matchingToolCalls.map(match => match.toolName).join(', ')})`;

    userMessageMatches.forEach(match => {
      const singleLineMessage = match.message.replace(/\s+/g, ' ').trim();
      console.log(
        `${callId} | ${startTime} | Keywords: ${match.matchedKeywords.join(', ')} | ` +
        `User: ${singleLineMessage} | "${toolNamePrefix}" tool called: ${toolResult}`
      );
    });
  });

  return { inspectedCallCount, keywords, toolNamePrefix, matchedCalls };
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
  findMatchingToolCalls,
  findMatchingUserMessages,
  formatLocalCallTime,
  requireDate,
  requireKeywords,
  scanCallChunks,
};
