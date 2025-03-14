import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio";
import { z } from "zod";
import { getLlmTraceById, listLlmTraces } from "./langwatch-api";
import { version } from "../package.json" assert { type: "json" };

function loadAndValidateArgs() {
  const args = process.argv.slice(2);

  let apiKey = process.env.LANGWATCH_API_KEY;
  let endpoint = process.env.LANGWATCH_ENDPOINT;

  args.forEach(arg => {
    const [key, value] = arg.split('=');
    if (key === '--apiKey') {
      apiKey = value;
    } else if (key === '--endpoint') {
      endpoint = value;
    }
  });

  if (!apiKey) {
    throw new Error("API key is required. Please provide it using --apiKey=<your_api_key>");
  }

  return {
    apiKey: String(apiKey),
    endpoint: String(endpoint || 'https://app.langwatch.ai'),
  };
}

// Use the function to get apiKey and endpoint
const { apiKey, endpoint } = loadAndValidateArgs();

const server = new McpServer({
  name: "LangWatch",
  version,
});

server.tool(
  "get_latest_traces",
  {
    pageOffset: z.number().optional(),
    daysBackToSearch: z.number().optional(),
  },
  async ({ pageOffset, daysBackToSearch }) => {
    const response = await listLlmTraces(apiKey, {
      pageOffset,
      timeTravelDays: daysBackToSearch ?? 1,
      langWatchEndpoint: endpoint,
    });

    return {
      content: [{
        type: "text",
        text: JSON.stringify(response, null, 2),
      }],
    };
  },
);

server.tool(
  "get_trace_by_id",
  {
    id: z.string(),
  },
  async ({ id }) => {
    try {
      const response = await getLlmTraceById(apiKey, id, {
        langWatchEndpoint: endpoint,
      });

      return {
        content: [{
          type: "text",
          text: JSON.stringify(response, null, 2),
        }]
      };
    } catch (error) {
      if (error instanceof Error && error.message === "Trace not found") {
        return {
          content: [{
            type: "text",
            text: "Trace not found 😭😭😭😭. If the trace was created recently, it may not be available yet.",
          }]
        };
      }

      throw error;
    }
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
