require('dotenv').config();

const assistantId = process.env.ASSISTANT_ID;
const apiKey = process.env.VAPI_API_KEY;

/**
 * Fetches the configured Vapi assistant, prints its full response, then
 * compares the assistant's configured tool IDs against the account's tools.
 */
async function fetchAssistantInfo() {
  try {
    if (!assistantId) {
      throw new Error('ASSISTANT_ID environment variable is required');
    }
    
    if (!apiKey) {
      throw new Error('VAPI_API_KEY environment variable is required');
    }

    const url = `https://api.vapi.ai/assistant/${assistantId}`;
    console.log(`Fetching assistant from: ${url}`);
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    console.log('\nResponse:');
    console.log(JSON.stringify(data, null, 2));
    
    const myToolIds = data.model?.toolIds;
    console.log('\nTool IDs:');
    console.log(myToolIds);

    // Fetch all tools
    const toolsUrl = 'https://api.vapi.ai/tool?limit=1000';
    console.log(`\nFetching all tools from: ${toolsUrl}`);
    
    const toolsResponse = await fetch(toolsUrl, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
    });

    if (!toolsResponse.ok) {
      throw new Error(`HTTP error! status: ${toolsResponse.status}`);
    }

    const allTools = await toolsResponse.json();
    console.log(`\nTotal tools fetched: ${allTools.length} tools`);

    // Match toolIds with tools and print names
    if (myToolIds && Array.isArray(myToolIds) && myToolIds.length > 0) {
      // Create a map of tool IDs to tools for faster lookup
      const toolMap = new Map(allTools.map(tool => [tool.id, tool]));
      
      // Find matched tools
      const matchedTools = myToolIds
        .map(id => toolMap.get(id))
        .filter(tool => tool !== undefined);
      
      // Find unmatched tool IDs
      const unmatchedToolIds = myToolIds.filter(id => !toolMap.has(id));
      
      // Find tools with weird or invalid names
      const weirdNameTools = matchedTools.filter(tool => {
        const name = String(tool.name || '').toLowerCase();
        return name === 'undefined' || name === 'unknown' || name === 'null' || !tool.name;
      });
      
      // Print matched tool names
      console.log('\nMatched Tool Names:');
      if (matchedTools.length > 0) {
        matchedTools.forEach(tool => {
          console.log(`- ${tool.name}`);
        });
      } else {
        console.log('(none)');
      }
      
      // Print matched tools with weird names
      console.log('\nMatched Tools with Weird or Invalid Names:');
      if (weirdNameTools.length > 0) {
        weirdNameTools.forEach(tool => {
          console.log(`- ${tool.name || '(no name)'} (ID: ${tool.id})`);
        });
      } else {
        console.log('(none)');
      }
      
      // Print unmatched tool IDs
      console.log('\nUnmatched Tool IDs:');
      if (unmatchedToolIds.length > 0) {
        unmatchedToolIds.forEach(id => {
          console.log(`- ${id}`);
        });
      } else {
        console.log('(none)');
      }
    } else {
      console.log('\nNo tool IDs found in assistant model.');
    }
  } catch (error) {
    console.error('Error:', error.message);
  }
}

fetchAssistantInfo();

