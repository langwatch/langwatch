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
  "Discover available filter fields, metrics, aggregation types, group-by options, and scenario schema for LangWatch queries. Call this before using search_traces, get_analytics, or scenario tools to understand available options.",
  {
    category: z
      .enum(["filters", "metrics", "aggregations", "groups", "scenarios", "all"])
      .describe("Which schema category to discover"),
  },
  async ({ category }) => {
    if (category === "scenarios") {
      const { formatScenarioSchema } = await import("./tools/discover-scenario-schema.js");
      return { content: [{ type: "text", text: formatScenarioSchema() }] };
    }
    const { formatSchema } = await import("./tools/discover-schema.js");
    let text = formatSchema(category);
    if (category === "all") {
      const { formatScenarioSchema } = await import("./tools/discover-scenario-schema.js");
      text += "\n\n" + formatScenarioSchema();
    }
    return { content: [{ type: "text", text }] };
  }
);

server.tool(
  "search_traces",
  "Search LangWatch traces with filters, text query, and date range. Returns AI-readable trace digests by default. Use format: 'json' for full raw data.",
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
    format: z
      .enum(["digest", "json"])
      .optional()
      .describe(
        "Output format: 'digest' (default, AI-readable) or 'json' (full raw data)"
      ),
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
  "Get full details of a single trace by ID. Returns AI-readable trace digest by default. Use format: 'json' for full raw data including all spans.",
  {
    traceId: z.string().describe("The trace ID to retrieve"),
    format: z
      .enum(["digest", "json"])
      .optional()
      .describe(
        "Output format: 'digest' (default, AI-readable) or 'json' (full raw data)"
      ),
  },
  async (params) => {
    const { requireApiKey } = await import("./config.js");
    requireApiKey();
    const { handleGetTrace } = await import("./tools/get-trace.js");
    return {
      content: [{ type: "text", text: await handleGetTrace(params) }],
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

// --- Scenario Tools (require API key) ---

server.tool(
  "list_scenarios",
  "List all scenarios in the LangWatch project. Returns AI-readable digest by default.",
  {
    format: z
      .enum(["digest", "json"])
      .optional()
      .describe(
        "Output format: 'digest' (default, AI-readable) or 'json' (full raw data)"
      ),
  },
  async (params) => {
    const { requireApiKey } = await import("./config.js");
    requireApiKey();
    const { handleListScenarios } = await import("./tools/list-scenarios.js");
    return {
      content: [{ type: "text", text: await handleListScenarios(params) }],
    };
  }
);

server.tool(
  "get_scenario",
  "Get full details of a scenario by ID, including situation, criteria, and labels.",
  {
    scenarioId: z.string().describe("The scenario ID to retrieve"),
    format: z
      .enum(["digest", "json"])
      .optional()
      .describe(
        "Output format: 'digest' (default, AI-readable) or 'json' (full raw data)"
      ),
  },
  async (params) => {
    const { requireApiKey } = await import("./config.js");
    requireApiKey();
    const { handleGetScenario } = await import("./tools/get-scenario.js");
    return {
      content: [{ type: "text", text: await handleGetScenario(params) }],
    };
  }
);

server.tool(
  "create_scenario",
  "Create a new scenario in the LangWatch project. Call discover_schema({ category: 'scenarios' }) first to learn how to write effective situations and criteria.",
  {
    name: z.string().describe("Scenario name"),
    situation: z
      .string()
      .describe("The context or setup describing what the user/agent is doing"),
    criteria: z
      .array(z.string())
      .optional()
      .describe("Pass/fail conditions the agent's response must satisfy"),
    labels: z
      .array(z.string())
      .optional()
      .describe("Tags for organizing and filtering scenarios"),
  },
  async (params) => {
    const { requireApiKey } = await import("./config.js");
    requireApiKey();
    const { handleCreateScenario } = await import(
      "./tools/create-scenario.js"
    );
    return {
      content: [{ type: "text", text: await handleCreateScenario(params) }],
    };
  }
);

server.tool(
  "update_scenario",
  "Update an existing scenario.",
  {
    scenarioId: z.string().describe("The scenario ID to update"),
    name: z.string().optional().describe("Updated scenario name"),
    situation: z.string().optional().describe("Updated situation"),
    criteria: z
      .array(z.string())
      .optional()
      .describe("Updated criteria"),
    labels: z
      .array(z.string())
      .optional()
      .describe("Updated labels"),
  },
  async (params) => {
    const { requireApiKey } = await import("./config.js");
    requireApiKey();
    const { handleUpdateScenario } = await import(
      "./tools/update-scenario.js"
    );
    return {
      content: [{ type: "text", text: await handleUpdateScenario(params) }],
    };
  }
);

server.tool(
  "archive_scenario",
  "Archive (soft-delete) a scenario.",
  {
    scenarioId: z.string().describe("The scenario ID to archive"),
  },
  async (params) => {
    const { requireApiKey } = await import("./config.js");
    requireApiKey();
    const { handleArchiveScenario } = await import(
      "./tools/archive-scenario.js"
    );
    return {
      content: [{ type: "text", text: await handleArchiveScenario(params) }],
    };
  }
);

await server.connect(transport);
