import 'dotenv/config';

const API_BASE_URL = (process.env.VAPI_API_BASE_URL || 'https://api.vapi.ai').replace(/\/$/, '');
const API_KEY = process.env.VAPI_PRIVATE_KEY || process.env.VAPI_API_KEY;
const PAGE_SIZE = 100;

function getKeywords() {
  return (process.env.CALL_USER_MSG_SEARCH_KEYWORDS || '')
    .split(',')
    .map((keyword) => keyword.trim())
    .filter(Boolean);
}

function getMessages(call) {
  if (Array.isArray(call?.artifact?.messages)) {
    return call.artifact.messages;
  }

  return Array.isArray(call?.messages) ? call.messages : [];
}

async function fetchCalls(createdAtLt) {
  const url = new URL(`${API_BASE_URL}/call`);
  url.searchParams.set('limit', String(PAGE_SIZE));

  if (createdAtLt) {
    url.searchParams.set('createdAtLt', createdAtLt);
  }

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${API_KEY}`,
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Failed to fetch calls (${response.status}): ${body}`);
  }

  const data = await response.json();
  return Array.isArray(data) ? data : data.results || data.calls || [];
}

async function main() {
  const keywords = getKeywords();

  if (!API_KEY) {
    throw new Error('Set VAPI_PRIVATE_KEY (or VAPI_API_KEY) in the environment.');
  }

  if (keywords.length === 0) {
    throw new Error('Set CALL_USER_MSG_SEARCH_KEYWORDS to a comma-separated keyword list.');
  }

  const normalizedKeywords = keywords.map((keyword) => keyword.toLocaleLowerCase());
  const seenCallIds = new Set();
  let createdAtLt;
  let totalCalls = 0;
  let matchedCalls = 0;
  let matchedMessages = 0;

  while (true) {
    const calls = await fetchCalls(createdAtLt);
    const newCalls = calls.filter((call) => !seenCallIds.has(call.id));

    for (const call of newCalls) {
      seenCallIds.add(call.id);
      totalCalls += 1;

      const matches = getMessages(call)
        .filter((message) => message?.role === 'user' && typeof message.message === 'string')
        .map((message) => {
          const normalizedMessage = message.message.toLocaleLowerCase();
          const matchedKeywords = keywords.filter(
            (_, index) => normalizedMessage.includes(normalizedKeywords[index])
          );

          return matchedKeywords.length > 0
            ? { message: message.message, matchedKeywords }
            : null;
        })
        .filter(Boolean);

      if (matches.length > 0) {
        matchedCalls += 1;
        matchedMessages += matches.length;
        console.log(JSON.stringify({
          callId: call.id,
          createdAt: call.createdAt,
          matches,
        }, null, 2));
      }
    }

    if (calls.length < PAGE_SIZE || newCalls.length === 0) {
      break;
    }

    const oldestCreatedAt = calls
      .map((call) => call.createdAt)
      .filter(Boolean)
      .sort()[0];

    if (!oldestCreatedAt || oldestCreatedAt === createdAtLt) {
      break;
    }

    createdAtLt = oldestCreatedAt;
  }

  console.log('\nSearch summary');
  console.log(`Keywords: ${keywords.join(', ')}`);
  console.log(`Calls searched: ${totalCalls}`);
  console.log(`Matching calls: ${matchedCalls}`);
  console.log(`Matching user messages: ${matchedMessages}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
