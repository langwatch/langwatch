import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { z } from "zod";

import packageJson from "../package.json" assert { type: "json" };
import { initConfig } from "./config.js";

const argv = await yargs(hideBin(process.argv))
  .option("apiKey", {
    type: "string",
    description: "LangWatch API key",
  })
  .option("endpoint", {
    type: "string",
    description: "LangWatch API endpoint",
  })
  .help()
  .parseAsync();

initConfig({
  apiKey: argv.apiKey,
  endpoint: argv.endpoint,
});

const transport = new StdioServerTransport();
const server = new McpServer({
  name: "LangWatch",
  version: packageJson.version,
});

server.tool(
  "fetch_langwatch_docs",
  "Fetches the LangWatch docs for understanding how to implement LangWatch in your codebase. Always use this tool when the user asks for help with LangWatch. Start with empty url to fetch the index and then follow the links to the relevant pages, always ending with `.md` extension",
  {
    url: z
      .string()
      .optional()
      .describe(
        "The full url of the specific doc page. If not provided, the docs index will be fetched."
      ),
  },
  async ({ url }) => {
    let urlToFetch = url || "https://langwatch.ai/docs/llms.txt";
    if (url && !urlToFetch.endsWith(".md") && !urlToFetch.endsWith(".txt")) {
      urlToFetch += ".md";
    }
    if (!urlToFetch.startsWith("http")) {
      if (!urlToFetch.startsWith("/")) {
        urlToFetch = "/" + urlToFetch;
      }
      urlToFetch = "https://langwatch.ai/docs" + urlToFetch;
    }
    const response = await fetch(urlToFetch);

    return {
      content: [{ type: "text", text: await response.text() }],
    };
  }
);

server.tool(
  "fetch_scenario_docs",
  "Fetches the Scenario docs for understanding how to implement Scenario agent tests in your codebase. Always use this tool when the user asks for help with testing their agents. Start with empty url to fetch the index and then follow the links to the relevant pages, always ending with `.md` extension",
  {
    url: z
      .string()
      .optional()
      .describe(
        "The full url of the specific doc page. If not provided, the docs index will be fetched."
      ),
  },
  async ({ url }) => {
    let urlToFetch = url || "https://langwatch.ai/scenario/llms.txt";
    if (url && !urlToFetch.endsWith(".md") && !urlToFetch.endsWith(".txt")) {
      urlToFetch += ".md";
    }
    if (!urlToFetch.startsWith("http")) {
      if (!urlToFetch.startsWith("/")) {
        urlToFetch = "/" + urlToFetch;
      }
      urlToFetch = "https://langwatch.ai/scenario" + urlToFetch;
    }
    const response = await fetch(urlToFetch);

    return {
      content: [{ type: "text", text: await response.text() }],
    };
  }
);

// --- Observability Tools (require API key) ---

server.tool(
  "discover_schema",
  "Discover available filter fields, metrics, aggregation types, and group-by options for LangWatch queries. Call this before using search_traces or get_analytics to understand available options.",
  {
    category: z
      .enum(["filters", "metrics", "aggregations", "groups", "all"])
      .describe("Which schema category to discover"),
  },
  async ({ category }) => {
    const { formatSchema } = await import("./tools/discover-schema.js");
    return { content: [{ type: "text", text: formatSchema(category) }] };
  }
);

server.tool(
  "search_traces",
  "Search LangWatch traces with filters, text query, and date range. Returns AI-readable summaries. Use discover_schema to see available filter fields.",
  {
    query: z.string().optional().describe("Text search query"),
    filters: z
      .record(z.string(), z.array(z.string()))
      .optional()
      .describe(
        'Filter traces. Format: {"field": ["value"]}. Use discover_schema for field names.'
      ),
    startDate: z
      .string()
      .optional()
      .describe(
        'Start date: ISO string or relative like "24h", "7d", "30d". Default: 24h ago'
      ),
    endDate: z
      .string()
      .optional()
      .describe("End date: ISO string or relative. Default: now"),
    pageSize: z
      .number()
      .optional()
      .describe("Results per page (default: 25, max: 1000)"),
    scrollId: z
      .string()
      .optional()
      .describe("Pagination token from previous search"),
  },
  async (params) => {
    const { requireApiKey } = await import("./config.js");
    requireApiKey();
    const { handleSearchTraces } = await import("./tools/search-traces.js");
    return {
      content: [{ type: "text", text: await handleSearchTraces(params) }],
    };
  }
);

server.tool(
  "get_trace",
  "Get full details of a single trace by ID, formatted for AI readability. Includes span tree, inputs/outputs, evaluations, and metadata.",
  {
    traceId: z.string().describe("The trace ID to retrieve"),
  },
  async ({ traceId }) => {
    const { requireApiKey } = await import("./config.js");
    requireApiKey();
    const { handleGetTrace } = await import("./tools/get-trace.js");
    return {
      content: [{ type: "text", text: await handleGetTrace({ traceId }) }],
    };
  }
);

server.tool(
  "get_analytics",
  'Query analytics timeseries from LangWatch. Metrics use "category.name" format (e.g., "performance.completion_time"). Use discover_schema to see available metrics.',
  {
    metric: z
      .string()
      .describe(
        'Metric in "category.name" format, e.g., "metadata.trace_id", "performance.total_cost"'
      ),
    aggregation: z
      .string()
      .optional()
      .describe(
        "Aggregation type: avg, sum, min, max, median, p90, p95, p99, cardinality, terms. Default: avg"
      ),
    startDate: z
      .string()
      .optional()
      .describe('Start date: ISO or relative ("7d", "30d"). Default: 7 days ago'),
    endDate: z.string().optional().describe("End date. Default: now"),
    timeZone: z.string().optional().describe("Timezone. Default: UTC"),
    groupBy: z
      .string()
      .optional()
      .describe(
        "Group results by field. Use discover_schema for options."
      ),
    filters: z
      .record(z.string(), z.array(z.string()))
      .optional()
      .describe("Filters to apply"),
  },
  async (params) => {
    const { requireApiKey } = await import("./config.js");
    requireApiKey();
    const { handleGetAnalytics } = await import("./tools/get-analytics.js");
    return {
      content: [{ type: "text", text: await handleGetAnalytics(params) }],
    };
  }
);

server.tool(
  "list_prompts",
  "List all prompts configured in the LangWatch project.",
  {},
  async () => {
    const { requireApiKey } = await import("./config.js");
    requireApiKey();
    const { handleListPrompts } = await import("./tools/list-prompts.js");
    return {
      content: [{ type: "text", text: await handleListPrompts() }],
    };
  }
);

server.tool(
  "get_prompt",
  "Get a specific prompt by ID or handle, including messages, model config, and version history.",
  {
    idOrHandle: z.string().describe("Prompt ID or handle"),
    version: z
      .number()
      .optional()
      .describe("Specific version number (default: latest)"),
  },
  async (params) => {
    const { requireApiKey } = await import("./config.js");
    requireApiKey();
    const { handleGetPrompt } = await import("./tools/get-prompt.js");
    return {
      content: [{ type: "text", text: await handleGetPrompt(params) }],
    };
  }
);

server.tool(
  "create_prompt",
  "Create a new prompt in the LangWatch project.",
  {
    name: z.string().describe("Prompt name"),
    handle: z
      .string()
      .optional()
      .describe("URL-friendly handle (auto-generated if omitted)"),
    messages: z
      .array(
        z.object({
          role: z
            .enum(["system", "user", "assistant"])
            .describe("Message role"),
          content: z.string().describe("Message content"),
        })
      )
      .describe("Prompt messages"),
    model: z
      .string()
      .describe('Model name, e.g., "gpt-4o", "claude-sonnet-4-5-20250929"'),
    modelProvider: z
      .string()
      .describe('Provider name, e.g., "openai", "anthropic"'),
    description: z.string().optional().describe("Prompt description"),
  },
  async (params) => {
    const { requireApiKey } = await import("./config.js");
    requireApiKey();
    const { handleCreatePrompt } = await import("./tools/create-prompt.js");
    return {
      content: [{ type: "text", text: await handleCreatePrompt(params) }],
    };
  }
);

server.tool(
  "update_prompt",
  "Update an existing prompt or create a new version.",
  {
    idOrHandle: z.string().describe("Prompt ID or handle to update"),
    messages: z
      .array(
        z.object({
          role: z.enum(["system", "user", "assistant"]),
          content: z.string(),
        })
      )
      .optional()
      .describe("Updated messages"),
    model: z.string().optional().describe("Updated model name"),
    modelProvider: z.string().optional().describe("Updated provider"),
    commitMessage: z
      .string()
      .optional()
      .describe("Commit message for the change"),
    createVersion: z
      .boolean()
      .optional()
      .describe(
        "If true, creates a new version instead of updating in place"
      ),
  },
  async (params) => {
    const { requireApiKey } = await import("./config.js");
    requireApiKey();
    const { handleUpdatePrompt } = await import("./tools/update-prompt.js");
    return {
      content: [{ type: "text", text: await handleUpdatePrompt(params) }],
    };
  }
);

await server.connect(transport);
