import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

import { getLlmTraceById, listLlmTraces, searchTraces } from "./langwatch-api";
import packageJson from "../package.json" assert { type: "json" };

function loadAndValidateArgs(): { apiKey: string; endpoint: string } {
  const argv = yargs(hideBin(process.argv))
    .option("apiKey", {
      type: "string",
      description: "LangWatch API key",
    })
    .option("endpoint", {
      type: "string",
      description: "LangWatch API endpoint",
      default: "https://app.langwatch.ai",
    })
    .help()
    .alias("help", "h")
    .parseSync();

  // Use environment variables as fallback
  const apiKey = argv.apiKey ?? process.env.LANGWATCH_API_KEY;
  const endpoint = argv.endpoint ?? process.env.LANGWATCH_ENDPOINT ?? "https://app.langwatch.ai";

  if (!apiKey) {
    throw new Error(
      "API key is required. Please provide it using --apiKey <your_api_key> or set LANGWATCH_API_KEY environment variable"
    );
  }

  return {
    apiKey: String(apiKey),
    endpoint: String(endpoint),
  };
}

const { apiKey, endpoint } = loadAndValidateArgs();

const transport = new StdioServerTransport();
const server = new McpServer({
  name: "LangWatch",
  version: packageJson.version,
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
      endpoint,
    });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(response, null, 2),
        },
      ],
    };
  }
);

server.tool(
  "get_trace_by_id",
  { id: z.string() },
  async ({ id }) => {
    try {
      const response = await getLlmTraceById(apiKey, id, {
        endpoint,
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response, null, 2),
          },
        ],
      };
    } catch (error) {
      if (error instanceof Error && error.message === "Trace not found") {
        return {
          content: [
            {
              type: "text",
              text: "Trace not found 😭😭😭😭. If the trace was created recently, it may not be available yet.",
            },
          ],
        };
      }

      throw error;
    }
  }
);

createListTracesByMetadataTool("list_traces_by_user_id", "userId", "metadata.user_id");
createListTracesByMetadataTool("list_traces_by_customer_id", "customerId", "metadata.customer_id");
createListTracesByMetadataTool("list_traces_by_thread_id", "threadId", "metadata.thread_id");

await server.connect(transport);

function createListTracesByMetadataTool(name: string, argName: "userId" | "customerId" | "threadId", metadataKey: string) {
  return server.tool(
    name,
    {
      [argName]: z.string(),
      pageSize: z.number().optional(),
      pageOffset: z.number().optional(),
      daysBackToSearch: z.number().optional(),
    },
    async ({ pageSize, pageOffset, daysBackToSearch, ...restArgs }) => {
      const response = await searchTraces(apiKey, {
        endpoint,
        pageSize: pageSize as number | undefined,
        pageOffset: pageOffset as number | undefined,
        timeTravelDays: (daysBackToSearch ?? 1) as number,
        filters: {
          [metadataKey]: [restArgs[argName] as string],
        },
      });
  
      return {
        content: [
          { type: "text", text: JSON.stringify(response, null, 2) },
        ],
      };
    }
  );
}
