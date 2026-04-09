import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import packageJson from "../package.json" assert { type: "json" };
import { requireApiKey } from "./config.js";

const modelSchema = z
  .string()
  .describe(
    'Model in "provider/model-name" format, e.g., "openai/gpt-4o", "anthropic/claude-sonnet-4-5-20250929"'
  );

/**
 * Creates a new McpServer instance with all LangWatch tools registered.
 *
 * This is used both for stdio mode (single server) and HTTP mode (per-session servers).
 */
export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "LangWatch",
    version: packageJson.version,
  });

  registerTools(server);

  return server;
}

/**
 * Wraps a tool handler with error logging. In HTTP mode (production),
 * tool errors are caught by the MCP SDK and returned to the client as
 * error responses — but without server-side logs we can't diagnose them.
 */
function withToolLogging<T extends unknown[], R>(
  toolName: string,
  fn: (...args: T) => Promise<R>,
): (...args: T) => Promise<R> {
  return async (...args: T) => {
    try {
      return await fn(...args);
    } catch (error) {
      console.error(
        `[MCP tool] ${toolName} failed:`,
        error instanceof Error ? error.message : error,
        error instanceof Error ? error.stack : "",
      );
      throw error;
    }
  };
}

function registerTools(server: McpServer): void {
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
    withToolLogging("fetch_langwatch_docs", async ({ url }) => {
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
    })
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
    withToolLogging("fetch_scenario_docs", async ({ url }) => {
      let urlToFetch = url || "https://langwatch.ai/scenario/llms.txt";
      if (url && !urlToFetch.endsWith(".md") && !urlToFetch.endsWith(".txt")) {
        urlToFetch += ".md";
      }
      if (!urlToFetch.startsWith("http")) {
        if (!urlToFetch.startsWith("/")) {
          urlToFetch = "/" + urlToFetch;
        }
        urlToFetch = "https://langwatch.ai" + urlToFetch;
      }
      const response = await fetch(urlToFetch);

      return {
        content: [{ type: "text", text: await response.text() }],
      };
    })
  );

  // --- Observability Tools (require API key) ---

  server.tool(
    "discover_schema",
    "Discover available filter fields, metrics, aggregation types, group-by options, scenario schema, and evaluator types for LangWatch queries. Call this before using search_traces, get_analytics, scenario tools, or evaluator tools to understand available options.",
    {
      category: z
        .enum([
          "filters",
          "metrics",
          "aggregations",
          "groups",
          "scenarios",
          "evaluators",
          "all",
        ])
        .describe("Which schema category to discover"),
      evaluatorType: z
        .string()
        .optional()
        .describe(
          "When category is 'evaluators', provide a specific evaluator type (e.g. 'langevals/llm_judge') to get its full schema details"
        ),
    },
    async ({ category, evaluatorType }) => {
      if (category === "scenarios") {
        const { formatScenarioSchema } = await import(
          "./tools/discover-scenario-schema.js"
        );
        return {
          content: [{ type: "text", text: formatScenarioSchema() }],
        };
      }
      if (category === "evaluators") {
        const { formatEvaluatorSchema } = await import(
          "./tools/discover-evaluator-schema.js"
        );
        return {
          content: [
            { type: "text", text: formatEvaluatorSchema(evaluatorType) },
          ],
        };
      }
      const { formatSchema } = await import("./tools/discover-schema.js");
      let text = formatSchema(category);
      if (category === "all") {
        const { formatScenarioSchema } = await import(
          "./tools/discover-scenario-schema.js"
        );
        text += "\n\n" + formatScenarioSchema();
        const { formatEvaluatorSchema } = await import(
          "./tools/discover-evaluator-schema.js"
        );
        text += "\n\n" + formatEvaluatorSchema();
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
    withToolLogging("search_traces", async (params) => {
      requireApiKey();
      const { handleSearchTraces } = await import("./tools/search-traces.js");
      return {
        content: [{ type: "text", text: await handleSearchTraces(params) }],
      };
    })
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
    withToolLogging("get_trace", async (params) => {
      requireApiKey();
      const { handleGetTrace } = await import("./tools/get-trace.js");
      return {
        content: [{ type: "text", text: await handleGetTrace(params) }],
      };
    })
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
        .describe(
          'Start date: ISO or relative ("7d", "30d"). Default: 7 days ago'
        ),
      endDate: z.string().optional().describe("End date. Default: now"),
      timeZone: z.string().optional().describe("Timezone. Default: UTC"),
      groupBy: z
        .string()
        .optional()
        .describe("Group results by field. Use discover_schema for options."),
      filters: z
        .record(z.string(), z.array(z.string()))
        .optional()
        .describe("Filters to apply"),
    },
    withToolLogging("get_analytics", async (params) => {
      requireApiKey();
      const { handleGetAnalytics } = await import("./tools/get-analytics.js");
      return {
        content: [{ type: "text", text: await handleGetAnalytics(params) }],
      };
    })
  );

  // --- Platform Prompt Tools (require API key) ---
  // These tools manage prompts on the LangWatch platform via API.
  // For code-based prompt management, see `fetch_langwatch_docs` for the CLI/SDK approach.

  server.tool(
    "platform_create_prompt",
    `Create a new prompt on the LangWatch platform.

NOTE: Prompts can be managed two ways. Determine which approach the user needs:

1. Code-based (CLI/SDK): If the user wants to manage prompts in their codebase, use \`fetch_langwatch_docs\` to learn about the prompt management CLI/SDK. This lets them version-control prompts and pull them into code.

2. Platform-based (LangWatch UI): If the user wants to manage prompts directly on the LangWatch platform, use the \`platform_\` MCP tools (\`platform_create_prompt\`, \`platform_update_prompt\`, etc.).
`,
    {
      name: z.string().describe("Prompt display name"),
      handle: z
        .string()
        .optional()
        .describe(
          "URL-friendly handle (auto-generated from name if omitted)"
        ),
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
      model: modelSchema,
      tags: z.array(z.string()).optional().describe(
        'Tags to assign to the initial version (e.g., ["production", "staging"]). ' +
        'Built-in tags: "latest" (auto-assigned), "production", "staging". Custom tags must be created first.'
      ),
    },
    withToolLogging("platform_create_prompt", async (params) => {
      requireApiKey();
      const { handleCreatePrompt } = await import("./tools/create-prompt.js");
      return {
        content: [{ type: "text", text: await handleCreatePrompt(params) }],
      };
    })
  );

  server.tool(
    "platform_list_prompts",
    "List all prompts configured on the LangWatch platform.",
    {},
    withToolLogging("platform_list_prompts", async () => {
      requireApiKey();
      const { handleListPrompts } = await import("./tools/list-prompts.js");
      return {
        content: [{ type: "text", text: await handleListPrompts() }],
      };
    })
  );

  server.tool(
    "platform_get_prompt",
    "Get a specific prompt from the LangWatch platform by ID or handle, including messages, model config, and version history.",
    {
      idOrHandle: z.string().describe("Prompt ID or handle"),
      version: z
        .number()
        .optional()
        .describe("Specific version number (default: latest)"),
      tag: z.string().optional().describe(
        'Fetch the version pointed to by this tag (e.g., "production", "staging"). ' +
        'Alternatively, use shorthand in idOrHandle: "pizza-prompt:production"'
      ),
    },
    withToolLogging("platform_get_prompt", async (params) => {
      if (params.version != null && params.tag) {
        return {
          content: [{ type: "text", text: "Error: Provide either 'version' or 'tag', not both." }],
          isError: true,
        };
      }
      requireApiKey();
      const { handleGetPrompt } = await import("./tools/get-prompt.js");
      return {
        content: [{ type: "text", text: await handleGetPrompt(params) }],
      };
    })
  );

  server.tool(
    "platform_update_prompt",
    "Update an existing prompt on the LangWatch platform. Every update creates a new version.",
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
      model: modelSchema.optional(),
      commitMessage: z
        .string()
        .describe("Commit message describing the change"),
      tags: z.array(z.string()).optional().describe(
        'Tags to assign to the new version created by this update.'
      ),
    },
    withToolLogging("platform_update_prompt", async (params) => {
      requireApiKey();
      const { handleUpdatePrompt } = await import("./tools/update-prompt.js");
      return {
        content: [{ type: "text", text: await handleUpdatePrompt(params) }],
      };
    })
  );

  server.tool(
    "platform_assign_prompt_tag",
    'Assign a tag (e.g. "production") to a specific version of a prompt. ' +
    'Use this to "deploy" a version by promoting it to the production tag.',
    {
      idOrHandle: z.string().describe("Prompt ID or handle"),
      tag: z.string().describe('Tag name (e.g., "production", "staging")'),
      versionId: z.string().describe("The version ID to assign the tag to"),
    },
    withToolLogging("platform_assign_prompt_tag", async (params) => {
      requireApiKey();
      const { handleAssignPromptTag } = await import("./tools/assign-prompt-tag.js");
      return {
        content: [{ type: "text", text: await handleAssignPromptTag(params) }],
      };
    })
  );

  server.tool(
    "platform_list_prompt_tags",
    "List all prompt tag definitions for the organization. " +
    "Shows built-in tags (latest, production, staging) and any custom tags.",
    {},
    withToolLogging("platform_list_prompt_tags", async () => {
      requireApiKey();
      const { handleListPromptTags } = await import("./tools/list-prompt-tags.js");
      return {
        content: [{ type: "text", text: await handleListPromptTags() }],
      };
    })
  );

  server.tool(
    "platform_create_prompt_tag",
    "Create a custom prompt tag definition for the organization. " +
    'Tag names must be non-numeric and not "latest".',
    {
      name: z.string().describe("Tag name to create"),
    },
    withToolLogging("platform_create_prompt_tag", async (params) => {
      requireApiKey();
      const { handleCreatePromptTag } = await import("./tools/create-prompt-tag.js");
      return {
        content: [{ type: "text", text: await handleCreatePromptTag(params) }],
      };
    })
  );

  server.tool(
    "platform_rename_prompt_tag",
    'Rename an existing prompt tag. The "latest" tag cannot be renamed.',
    {
      tag: z.string().describe("Current tag name to rename"),
      name: z.string().describe("New tag name"),
    },
    withToolLogging("platform_rename_prompt_tag", async (params) => {
      requireApiKey();
      const { handleRenamePromptTag } = await import("./tools/rename-prompt-tag.js");
      return {
        content: [{ type: "text", text: await handleRenamePromptTag(params) }],
      };
    })
  );

  server.tool(
    "platform_delete_prompt_tag",
    'Delete a prompt tag and all its assignments. The "latest" tag cannot be deleted.',
    {
      tag: z.string().describe("Tag name to delete"),
    },
    withToolLogging("platform_delete_prompt_tag", async (params) => {
      requireApiKey();
      const { handleDeletePromptTag } = await import("./tools/delete-prompt-tag.js");
      return {
        content: [{ type: "text", text: await handleDeletePromptTag(params) }],
      };
    })
  );

  // --- Platform Scenario Tools (require API key) ---
  // These tools manage scenarios on the LangWatch platform via API.
  // For code-based scenario testing, see `fetch_scenario_docs` for the SDK approach.

  server.tool(
    "platform_create_scenario",
    `Create a new scenario on the LangWatch platform. Call discover_schema({ category: 'scenarios' }) first to learn how to write effective situations and criteria.

NOTE: Scenarios can be created two ways. Determine which approach the user needs:

1. Code-based (local testing): If the user has a codebase with an AI agent they want to test, use \`fetch_scenario_docs\` to learn about the Scenario Python/TypeScript SDK. This lets them run tests locally and iterate in code.

2. Platform-based (LangWatch UI): If the user wants to manage scenarios directly on the LangWatch platform, use the \`platform_\` MCP tools (\`platform_create_scenario\`, \`platform_update_scenario\`, etc.).
`,
    {
      name: z.string().describe("Scenario name"),
      situation: z
        .string()
        .describe(
          "The context or setup describing what the user/agent is doing"
        ),
      criteria: z
        .array(z.string())
        .optional()
        .describe(
          "Pass/fail conditions the agent's response must satisfy"
        ),
      labels: z
        .array(z.string())
        .optional()
        .describe("Tags for organizing and filtering scenarios"),
    },
    withToolLogging("platform_create_scenario", async (params) => {
      requireApiKey();
      const { handleCreateScenario } = await import(
        "./tools/create-scenario.js"
      );
      return {
        content: [
          { type: "text", text: await handleCreateScenario(params) },
        ],
      };
    })
  );

  server.tool(
    "platform_list_scenarios",
    "List all scenarios on the LangWatch platform. Returns AI-readable digest by default.",
    {
      format: z
        .enum(["digest", "json"])
        .optional()
        .describe(
          "Output format: 'digest' (default, AI-readable) or 'json' (full raw data)"
        ),
    },
    withToolLogging("platform_list_scenarios", async (params) => {
      requireApiKey();
      const { handleListScenarios } = await import(
        "./tools/list-scenarios.js"
      );
      return {
        content: [
          { type: "text", text: await handleListScenarios(params) },
        ],
      };
    })
  );

  server.tool(
    "platform_get_scenario",
    "Get full details of a scenario on the LangWatch platform by ID, including situation, criteria, and labels.",
    {
      scenarioId: z.string().describe("The scenario ID to retrieve"),
      format: z
        .enum(["digest", "json"])
        .optional()
        .describe(
          "Output format: 'digest' (default, AI-readable) or 'json' (full raw data)"
        ),
    },
    withToolLogging("platform_get_scenario", async (params) => {
      requireApiKey();
      const { handleGetScenario } = await import("./tools/get-scenario.js");
      return {
        content: [{ type: "text", text: await handleGetScenario(params) }],
      };
    })
  );

  server.tool(
    "platform_update_scenario",
    "Update an existing scenario on the LangWatch platform.",
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
    withToolLogging("platform_update_scenario", async (params) => {
      requireApiKey();
      const { handleUpdateScenario } = await import(
        "./tools/update-scenario.js"
      );
      return {
        content: [
          { type: "text", text: await handleUpdateScenario(params) },
        ],
      };
    })
  );

  server.tool(
    "platform_archive_scenario",
    "Archive (soft-delete) a scenario on the LangWatch platform.",
    {
      scenarioId: z.string().describe("The scenario ID to archive"),
    },
    withToolLogging("platform_archive_scenario", async (params) => {
      requireApiKey();
      const { handleArchiveScenario } = await import(
        "./tools/archive-scenario.js"
      );
      return {
        content: [
          { type: "text", text: await handleArchiveScenario(params) },
        ],
      };
    })
  );

  // --- Platform Evaluator Tools (require API key) ---
  // These tools manage evaluators on the LangWatch platform via API.

  server.tool(
    "platform_create_evaluator",
    `Create an evaluator on the LangWatch platform. Useful for setting up LLM-as-judge and other evaluators to use in evaluation notebooks. Call discover_schema({ category: 'evaluators' }) first to see available evaluator types and their settings.`,
    {
      name: z.string().describe("Evaluator name"),
      config: z
        .record(z.string(), z.unknown())
        .describe(
          'Evaluator config object. Must include "evaluatorType" (e.g. "langevals/llm_boolean") and optional "settings" overrides.'
        ),
    },
    withToolLogging("platform_create_evaluator", async (params) => {
      requireApiKey();
      const { handleCreateEvaluator } = await import(
        "./tools/create-evaluator.js"
      );
      return {
        content: [
          { type: "text", text: await handleCreateEvaluator(params) },
        ],
      };
    })
  );

  server.tool(
    "platform_list_evaluators",
    "List all evaluators configured on the LangWatch platform.",
    {},
    withToolLogging("platform_list_evaluators", async () => {
      requireApiKey();
      const { handleListEvaluators } = await import(
        "./tools/list-evaluators.js"
      );
      return {
        content: [{ type: "text", text: await handleListEvaluators() }],
      };
    })
  );

  server.tool(
    "platform_get_evaluator",
    "Get full details of an evaluator on the LangWatch platform by ID or slug, including config, input fields, and output fields.",
    {
      idOrSlug: z
        .string()
        .describe("The evaluator ID or slug to retrieve"),
    },
    withToolLogging("platform_get_evaluator", async (params) => {
      requireApiKey();
      const { handleGetEvaluator } = await import(
        "./tools/get-evaluator.js"
      );
      return {
        content: [{ type: "text", text: await handleGetEvaluator(params) }],
      };
    })
  );

  server.tool(
    "platform_update_evaluator",
    "Update an existing evaluator on the LangWatch platform. The evaluatorType in config cannot be changed after creation.",
    {
      evaluatorId: z.string().describe("The evaluator ID to update"),
      name: z.string().optional().describe("Updated evaluator name"),
      config: z
        .record(z.string(), z.unknown())
        .optional()
        .describe(
          "Updated config settings. Note: evaluatorType cannot be changed after creation."
        ),
    },
    withToolLogging("platform_update_evaluator", async (params) => {
      requireApiKey();
      const { handleUpdateEvaluator } = await import(
        "./tools/update-evaluator.js"
      );
      return {
        content: [
          { type: "text", text: await handleUpdateEvaluator(params) },
        ],
      };
    })
  );

  // --- Platform Model Provider Tools (require API key) ---
  // These tools manage model provider API keys on the LangWatch platform.

  server.tool(
    "platform_set_model_provider",
    `Set or update a model provider on the LangWatch platform. Use this to configure API keys (e.g. OPENAI_API_KEY) needed to run evaluators. The API key is stored securely and never returned in responses. Omit customKeys to update other settings without changing existing keys.`,
    {
      provider: z
        .string()
        .describe(
          'Provider name, e.g., "openai", "anthropic", "azure", "custom"'
        ),
      enabled: z.boolean().describe("Whether the provider is enabled"),
      customKeys: z
        .record(z.string(), z.unknown())
        .optional()
        .describe(
          'API key configuration, e.g. { "OPENAI_API_KEY": "sk-..." }. Omit to keep existing keys.'
        ),
      defaultModel: z
        .string()
        .optional()
        .describe("Set as project default model"),
    },
    withToolLogging("platform_set_model_provider", async (params) => {
      requireApiKey();
      const { handleSetModelProvider } = await import(
        "./tools/set-model-provider.js"
      );
      return {
        content: [
          { type: "text", text: await handleSetModelProvider(params) },
        ],
      };
    })
  );

  server.tool(
    "platform_list_model_providers",
    "List all model providers configured on the LangWatch platform. API keys are masked in the response.",
    {},
    withToolLogging("platform_list_model_providers", async () => {
      requireApiKey();
      const { handleListModelProviders } = await import(
        "./tools/list-model-providers.js"
      );
      return {
        content: [{ type: "text", text: await handleListModelProviders() }],
      };
    })
  );
}
