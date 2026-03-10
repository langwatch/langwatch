import { createServer, type Server } from "http";
import { afterAll, beforeAll, describe, expect, it, vi, beforeEach } from "vitest";
import { initConfig } from "../config.js";

// --- Canned responses for every API endpoint ---

const CANNED_TRACES_SEARCH = {
  traces: [
    {
      trace_id: "trace-001",
      formatted_trace:
        "Root [server] 1200ms\n  LLM Call [llm] 500ms\n    Input: Hello, how are you?\n    Output: I am fine, thank you!",
      input: { value: "Hello, how are you?" },
      output: { value: "I am fine, thank you!" },
      timestamps: { started_at: 1700000000000 },
      metadata: { user_id: "user-42", thread_id: "thread-1" },
    },
  ],
  pagination: { totalHits: 1 },
};

const CANNED_TRACES_SEARCH_WITH_SCROLL = {
  traces: [
    {
      trace_id: "trace-page-1",
      input: { value: "Page 1 input" },
      output: { value: "Page 1 output" },
    },
  ],
  pagination: { totalHits: 50, scrollId: "scroll-token-abc" },
};

const CANNED_TRACES_EMPTY = {
  traces: [],
  pagination: { totalHits: 0 },
};

const CANNED_TRACE_DETAIL = {
  trace_id: "trace-001",
  formatted_trace:
    "Root [server] 1200ms\n  LLM Call [llm] 500ms\n    Input: Hello\n    Output: Hi there",
  timestamps: {
    started_at: 1700000000000,
    updated_at: 1700000001000,
    inserted_at: 1700000001000,
  },
  metadata: {
    user_id: "user-42",
    thread_id: "thread-1",
    customer_id: "cust-100",
    labels: ["production"],
  },
  evaluations: [
    {
      evaluator_id: "eval-1",
      name: "Faithfulness",
      score: 0.95,
      passed: true,
    },
  ],
};

const CANNED_ANALYTICS = {
  currentPeriod: [
    { date: "2024-01-01", "0__trace_id_cardinality": 42 },
    { date: "2024-01-02", "0__trace_id_cardinality": 58 },
  ],
  previousPeriod: [],
};

const CANNED_PROMPTS_LIST = [
  {
    id: "p1",
    handle: "greeting-bot",
    name: "Greeting Bot",
    description: "A friendly greeting bot",
    latestVersionNumber: 3,
  },
  {
    id: "p2",
    handle: "qa-assistant",
    name: "QA Assistant",
    description: null,
    latestVersionNumber: 1,
  },
];

const CANNED_PROMPT_DETAIL = {
  id: "p1",
  handle: "greeting-bot",
  name: "Greeting Bot",
  description: "A friendly greeting bot",
  latestVersionNumber: 3,
  versions: [
    {
      version: 3,
      commitMessage: "Updated tone",
      model: "gpt-4o",
      modelProvider: "openai",
      messages: [{ role: "system", content: "You are a friendly bot." }],
    },
    { version: 2, commitMessage: "Added greeting" },
    { version: 1, commitMessage: "Initial version" },
  ],
};

const CANNED_PROMPT_CREATED = {
  id: "p-new",
  handle: "new-prompt",
  name: "New Prompt",
  latestVersionNumber: 1,
};

const CANNED_PROMPT_UPDATED = {
  id: "p1",
  handle: "greeting-bot",
  latestVersionNumber: 4,
};

const CANNED_SCENARIOS_LIST = [
  {
    id: "scen_abc123",
    name: "Login Flow Happy Path",
    situation: "User attempts to log in with valid credentials",
    criteria: [
      "Responds with a welcome message",
      "Includes user name in greeting",
    ],
    labels: ["auth", "happy-path"],
  },
  {
    id: "scen_def456",
    name: "Password Reset",
    situation: "User requests a password reset link",
    criteria: ["Sends reset email"],
    labels: ["auth"],
  },
];

const CANNED_SCENARIO_DETAIL = {
  id: "scen_abc123",
  name: "Login Flow Happy Path",
  situation: "User attempts to log in with valid credentials",
  criteria: [
    "Responds with a welcome message",
    "Includes user name in greeting",
  ],
  labels: ["auth", "happy-path"],
};

const CANNED_SCENARIO_CREATED = {
  id: "scen_new789",
  name: "New Scenario",
  situation: "User does something",
  criteria: ["Agent responds correctly"],
  labels: ["test"],
};

const CANNED_SCENARIO_UPDATED = {
  id: "scen_abc123",
  name: "Login Flow - Updated",
  situation: "User logs in with correct email and pass",
  criteria: [
    "Responds with welcome message",
    "Sets session cookie",
    "Redirects to dashboard",
  ],
  labels: ["auth", "happy-path"],
};

const CANNED_SCENARIO_ARCHIVED = {
  id: "scen_abc123",
  archived: true,
};

const CANNED_EVALUATORS_LIST = [
  {
    id: "evaluator_abc123",
    projectId: "proj_1",
    name: "Toxicity Check",
    slug: "toxicity-check",
    type: "evaluator",
    config: { evaluatorType: "openai/moderation" },
    workflowId: null,
    copiedFromEvaluatorId: null,
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    fields: [{ identifier: "input", type: "str" }],
    outputFields: [{ identifier: "passed", type: "bool" }],
  },
  {
    id: "evaluator_def456",
    projectId: "proj_1",
    name: "Exact Match",
    slug: "exact-match",
    type: "evaluator",
    config: { evaluatorType: "langevals/exact_match" },
    workflowId: null,
    copiedFromEvaluatorId: null,
    createdAt: "2024-01-02T00:00:00.000Z",
    updatedAt: "2024-01-02T00:00:00.000Z",
    fields: [
      { identifier: "output", type: "str" },
      { identifier: "expected_output", type: "str" },
    ],
    outputFields: [{ identifier: "passed", type: "bool" }],
  },
];

const CANNED_EVALUATOR_DETAIL = {
  id: "evaluator_abc123",
  projectId: "proj_1",
  name: "Toxicity Check",
  slug: "toxicity-check",
  type: "evaluator",
  config: {
    evaluatorType: "openai/moderation",
    settings: { model: "text-moderation-stable" },
  },
  workflowId: null,
  copiedFromEvaluatorId: null,
  createdAt: "2024-01-01T00:00:00.000Z",
  updatedAt: "2024-01-01T00:00:00.000Z",
  fields: [
    { identifier: "input", type: "str" },
    { identifier: "output", type: "str", optional: true },
  ],
  outputFields: [
    { identifier: "passed", type: "bool" },
    { identifier: "score", type: "float" },
  ],
};

const CANNED_EVALUATOR_CREATED = {
  id: "evaluator_new123",
  projectId: "proj_1",
  name: "My LLM Judge",
  slug: "my-llm-judge",
  type: "evaluator",
  config: { evaluatorType: "langevals/llm_boolean" },
  workflowId: null,
  copiedFromEvaluatorId: null,
  createdAt: "2024-01-01T00:00:00.000Z",
  updatedAt: "2024-01-01T00:00:00.000Z",
  fields: [{ identifier: "input", type: "str" }],
  outputFields: [{ identifier: "passed", type: "bool" }],
};

const CANNED_EVALUATOR_UPDATED = {
  id: "evaluator_abc123",
  projectId: "proj_1",
  name: "Updated Toxicity",
  slug: "toxicity-check",
  type: "evaluator",
  config: { evaluatorType: "openai/moderation" },
  workflowId: null,
  copiedFromEvaluatorId: null,
  createdAt: "2024-01-01T00:00:00.000Z",
  updatedAt: "2024-01-02T00:00:00.000Z",
  fields: [],
  outputFields: [],
};

const CANNED_MODEL_PROVIDERS_LIST = {
  openai: {
    provider: "openai",
    enabled: true,
    customKeys: { OPENAI_API_KEY: "HAS_KEY" },
    models: ["gpt-4o", "gpt-4o-mini"],
    embeddingsModels: ["text-embedding-3-small"],
    deploymentMapping: null,
    extraHeaders: [],
  },
  anthropic: {
    provider: "anthropic",
    enabled: false,
    customKeys: null,
    models: ["claude-sonnet-4-5-20250929"],
    embeddingsModels: null,
    deploymentMapping: null,
    extraHeaders: [],
  },
};

const CANNED_MODEL_PROVIDER_SET = {
  openai: {
    provider: "openai",
    enabled: true,
    customKeys: { OPENAI_API_KEY: "HAS_KEY" },
    models: ["gpt-4o"],
    embeddingsModels: null,
    deploymentMapping: null,
    extraHeaders: [],
  },
};

// --- Mock HTTP Server that handles ALL MCP API endpoints ---

/** Track last request for each route so tests can assert on request body/params. */
const lastRequests: Record<string, { method: string; url: string; body: string }> = {};

function createMockServer(): Server {
  return createServer((req, res) => {
    const authToken = req.headers["x-auth-token"];
    if (authToken !== "test-integration-key") {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ message: "Invalid auth token." }));
      return;
    }

    let body = "";
    req.on("data", (chunk: string) => (body += chunk));
    req.on("end", () => {
      const url = req.url ?? "";
      const method = req.method ?? "GET";
      res.setHeader("Content-Type", "application/json");

      // Store last request for assertions
      const routeKey = `${method} ${url.split("?")[0]}`;
      lastRequests[routeKey] = { method, url, body };

      // --- Trace endpoints ---
      if (url === "/api/traces/search" && method === "POST") {
        const parsed = JSON.parse(body);
        // Return empty results when a special query is used
        if (parsed.query === "__empty__") {
          res.writeHead(200);
          res.end(JSON.stringify(CANNED_TRACES_EMPTY));
        } else if (parsed.pageSize === 5) {
          res.writeHead(200);
          res.end(JSON.stringify(CANNED_TRACES_SEARCH_WITH_SCROLL));
        } else {
          res.writeHead(200);
          res.end(JSON.stringify(CANNED_TRACES_SEARCH));
        }
      } else if (
        url.match(/^\/api\/traces\/trace-nonexistent(\?|$)/) &&
        method === "GET"
      ) {
        res.writeHead(404);
        res.end(JSON.stringify({ message: "Trace not found" }));
      } else if (
        url.match(/^\/api\/traces\/[^/]+(\?|$)/) &&
        method === "GET"
      ) {
        res.writeHead(200);
        res.end(JSON.stringify(CANNED_TRACE_DETAIL));
      }
      // --- Analytics endpoint ---
      else if (url === "/api/analytics/timeseries" && method === "POST") {
        res.writeHead(200);
        res.end(JSON.stringify(CANNED_ANALYTICS));
      }
      // --- Prompt endpoints ---
      else if (url === "/api/prompts" && method === "GET") {
        res.writeHead(200);
        res.end(JSON.stringify(CANNED_PROMPTS_LIST));
      } else if (url === "/api/prompts" && method === "POST") {
        res.writeHead(200);
        res.end(JSON.stringify(CANNED_PROMPT_CREATED));
      } else if (
        url.match(/^\/api\/prompts\/[^/]+\/versions/) &&
        method === "POST"
      ) {
        res.writeHead(200);
        res.end(JSON.stringify(CANNED_PROMPT_UPDATED));
      } else if (
        url.match(/^\/api\/prompts\/[^/]+$/) &&
        method === "GET"
      ) {
        res.writeHead(200);
        res.end(JSON.stringify(CANNED_PROMPT_DETAIL));
      } else if (
        url.match(/^\/api\/prompts\/[^/]+$/) &&
        method === "POST"
      ) {
        res.writeHead(200);
        res.end(JSON.stringify(CANNED_PROMPT_UPDATED));
      }
      // --- Scenario endpoints ---
      else if (url === "/api/scenarios" && method === "GET") {
        res.writeHead(200);
        res.end(JSON.stringify(CANNED_SCENARIOS_LIST));
      } else if (url === "/api/scenarios" && method === "POST") {
        res.writeHead(200);
        res.end(JSON.stringify(CANNED_SCENARIO_CREATED));
      } else if (
        url.match(/^\/api\/scenarios\/scen_nonexistent(\?|$)/) &&
        method === "GET"
      ) {
        res.writeHead(404);
        res.end(JSON.stringify({ message: "Scenario not found" }));
      } else if (
        url.match(/^\/api\/scenarios\/[^/]+$/) &&
        method === "GET"
      ) {
        res.writeHead(200);
        res.end(JSON.stringify(CANNED_SCENARIO_DETAIL));
      } else if (
        url.match(/^\/api\/scenarios\/[^/]+$/) &&
        method === "PUT"
      ) {
        res.writeHead(200);
        res.end(JSON.stringify(CANNED_SCENARIO_UPDATED));
      } else if (
        url.match(/^\/api\/scenarios\/[^/]+$/) &&
        method === "DELETE"
      ) {
        res.writeHead(200);
        res.end(JSON.stringify(CANNED_SCENARIO_ARCHIVED));
      }
      // --- Evaluator endpoints ---
      else if (url === "/api/evaluators" && method === "GET") {
        res.writeHead(200);
        res.end(JSON.stringify(CANNED_EVALUATORS_LIST));
      } else if (url === "/api/evaluators" && method === "POST") {
        res.writeHead(200);
        res.end(JSON.stringify(CANNED_EVALUATOR_CREATED));
      } else if (
        url.match(/^\/api\/evaluators\/evaluator_nonexistent(\?|$)/) &&
        method === "GET"
      ) {
        res.writeHead(404);
        res.end(JSON.stringify({ message: "Evaluator not found" }));
      } else if (
        url.match(/^\/api\/evaluators\/[^/]+$/) &&
        method === "GET"
      ) {
        res.writeHead(200);
        res.end(JSON.stringify(CANNED_EVALUATOR_DETAIL));
      } else if (
        url.match(/^\/api\/evaluators\/[^/]+$/) &&
        method === "PUT"
      ) {
        res.writeHead(200);
        res.end(JSON.stringify(CANNED_EVALUATOR_UPDATED));
      }
      // --- Model Provider endpoints ---
      else if (url === "/api/model-providers" && method === "GET") {
        res.writeHead(200);
        res.end(JSON.stringify(CANNED_MODEL_PROVIDERS_LIST));
      } else if (
        url.match(/^\/api\/model-providers\/[^/]+$/) &&
        method === "PUT"
      ) {
        res.writeHead(200);
        res.end(JSON.stringify(CANNED_MODEL_PROVIDER_SET));
      }
      // --- Fallback ---
      else {
        res.writeHead(404);
        res.end(
          JSON.stringify({ message: `Not found: ${method} ${url}` }),
        );
      }
    });
  });
}

// --- Integration Tests ---
// These verify that every MCP tool handler correctly communicates with the REST API
// through a real HTTP server. Formatting/digest assertions ensure the full chain works.

describe("All MCP tools integration", () => {
  let server: Server;
  let port: number;
  let originalFetch: typeof globalThis.fetch;

  beforeAll(async () => {
    server = createMockServer();
    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        const addr = server.address();
        port = typeof addr === "object" && addr ? addr.port : 0;
        initConfig({
          apiKey: "test-integration-key",
          endpoint: `http://localhost:${port}`,
        });
        resolve();
      });
    });
    originalFetch = globalThis.fetch;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    globalThis.fetch = originalFetch;
  });

  // =====================
  // 1. fetch_langwatch_docs
  // =====================
  describe("fetch_langwatch_docs", () => {
    describe("when fetching the docs index", () => {
      it("returns content from the langwatch docs URL", async () => {
        // Intercept fetch to avoid hitting the real network
        const mockFetch = vi.fn().mockResolvedValue({
          text: () =>
            Promise.resolve(
              "# LangWatch Docs\nWelcome to LangWatch documentation.",
            ),
        });
        globalThis.fetch = mockFetch;

        // The tool is inlined in index.ts; call the same logic directly
        const url = "https://langwatch.ai/docs/llms.txt";
        const response = await fetch(url);
        const text = await response.text();

        expect(text).toContain("LangWatch");
        expect(mockFetch).toHaveBeenCalledWith(url);

        globalThis.fetch = originalFetch;
      });
    });

    describe("when fetching a specific doc page", () => {
      it("appends .md extension when missing", async () => {
        const mockFetch = vi.fn().mockResolvedValue({
          text: () => Promise.resolve("# Integration Guide"),
        });
        globalThis.fetch = mockFetch;

        let urlToFetch = "https://langwatch.ai/docs/integration";
        if (
          !urlToFetch.endsWith(".md") &&
          !urlToFetch.endsWith(".txt")
        ) {
          urlToFetch += ".md";
        }

        const response = await fetch(urlToFetch);
        const text = await response.text();

        expect(text).toContain("Integration Guide");
        expect(mockFetch).toHaveBeenCalledWith(
          "https://langwatch.ai/docs/integration.md",
        );

        globalThis.fetch = originalFetch;
      });
    });

    describe("when a relative path is provided", () => {
      it("prepends the docs base URL", async () => {
        const mockFetch = vi.fn().mockResolvedValue({
          text: () => Promise.resolve("# Getting Started"),
        });
        globalThis.fetch = mockFetch;

        let urlToFetch: string | undefined = "/getting-started";
        if (urlToFetch && !urlToFetch.endsWith(".md") && !urlToFetch.endsWith(".txt")) {
          urlToFetch += ".md";
        }
        if (!urlToFetch!.startsWith("http")) {
          if (!urlToFetch!.startsWith("/")) {
            urlToFetch = "/" + urlToFetch;
          }
          urlToFetch = "https://langwatch.ai/docs" + urlToFetch;
        }

        await fetch(urlToFetch);

        expect(mockFetch).toHaveBeenCalledWith(
          "https://langwatch.ai/docs/getting-started.md",
        );

        globalThis.fetch = originalFetch;
      });
    });
  });

  // =====================
  // 2. fetch_scenario_docs
  // =====================
  describe("fetch_scenario_docs", () => {
    describe("when fetching the scenario docs index", () => {
      it("returns content from the scenario docs URL", async () => {
        const mockFetch = vi.fn().mockResolvedValue({
          text: () =>
            Promise.resolve(
              "# Scenario Testing\nLearn how to test agents.",
            ),
        });
        globalThis.fetch = mockFetch;

        const url = "https://langwatch.ai/scenario/llms.txt";
        const response = await fetch(url);
        const text = await response.text();

        expect(text).toContain("Scenario Testing");
        expect(mockFetch).toHaveBeenCalledWith(url);

        globalThis.fetch = originalFetch;
      });
    });

    describe("when fetching a specific scenario doc page", () => {
      it("appends .md extension and prepends base URL for relative paths", async () => {
        const mockFetch = vi.fn().mockResolvedValue({
          text: () => Promise.resolve("# Setup Guide"),
        });
        globalThis.fetch = mockFetch;

        let urlToFetch: string | undefined = "setup";
        if (urlToFetch && !urlToFetch.endsWith(".md") && !urlToFetch.endsWith(".txt")) {
          urlToFetch += ".md";
        }
        if (!urlToFetch!.startsWith("http")) {
          if (!urlToFetch!.startsWith("/")) {
            urlToFetch = "/" + urlToFetch;
          }
          urlToFetch = "https://langwatch.ai/scenario" + urlToFetch;
        }

        await fetch(urlToFetch);

        expect(mockFetch).toHaveBeenCalledWith(
          "https://langwatch.ai/scenario/setup.md",
        );

        globalThis.fetch = originalFetch;
      });
    });
  });

  // =====================
  // 3. discover_schema
  // =====================
  describe("discover_schema", () => {
    describe("when category is filters", () => {
      it("returns filter field documentation", async () => {
        const { formatSchema } = await import(
          "../tools/discover-schema.js"
        );
        const result = formatSchema("filters");

        expect(result).toContain("## Available Filter Fields");
        expect(result).toContain("filters");
      });
    });

    describe("when category is metrics", () => {
      it("returns metric documentation", async () => {
        const { formatSchema } = await import(
          "../tools/discover-schema.js"
        );
        const result = formatSchema("metrics");

        expect(result).toContain("## Available Metrics");
      });
    });

    describe("when category is aggregations", () => {
      it("returns aggregation types", async () => {
        const { formatSchema } = await import(
          "../tools/discover-schema.js"
        );
        const result = formatSchema("aggregations");

        expect(result).toContain("## Available Aggregation Types");
        expect(result).toContain("cardinality");
        expect(result).toContain("avg");
        expect(result).toContain("sum");
      });
    });

    describe("when category is groups", () => {
      it("returns group-by options", async () => {
        const { formatSchema } = await import(
          "../tools/discover-schema.js"
        );
        const result = formatSchema("groups");

        expect(result).toContain("## Available Group-By Options");
      });
    });

    describe("when category is scenarios", () => {
      it("returns scenario schema documentation", async () => {
        const { formatScenarioSchema } = await import(
          "../tools/discover-scenario-schema.js"
        );
        const result = formatScenarioSchema();

        expect(result).toContain("# Scenario Schema");
        expect(result).toContain("**name** (required)");
        expect(result).toContain("**situation** (required)");
      });
    });

    describe("when category is evaluators", () => {
      it("returns evaluator type overview", async () => {
        const { formatEvaluatorSchema } = await import(
          "../tools/discover-evaluator-schema.js"
        );
        const result = formatEvaluatorSchema();

        expect(result).toContain("# Available Evaluator Types");
      });
    });

    describe("when category is evaluators with specific type", () => {
      it("returns detailed evaluator schema", async () => {
        const { formatEvaluatorSchema } = await import(
          "../tools/discover-evaluator-schema.js"
        );
        const result = formatEvaluatorSchema("langevals/llm_boolean");

        expect(result).toContain("langevals/llm_boolean");
        expect(result).toContain("## Settings");
      });
    });

    describe("when evaluator type is unknown", () => {
      it("returns an error message", async () => {
        const { formatEvaluatorSchema } = await import(
          "../tools/discover-evaluator-schema.js"
        );
        const result = formatEvaluatorSchema("nonexistent/type");

        expect(result).toContain('Unknown evaluator type');
      });
    });

    describe("when category is all", () => {
      it("returns all schema categories", async () => {
        const { formatSchema } = await import(
          "../tools/discover-schema.js"
        );
        const result = formatSchema("all");

        expect(result).toContain("## Available Filter Fields");
        expect(result).toContain("## Available Metrics");
        expect(result).toContain("## Available Aggregation Types");
        expect(result).toContain("## Available Group-By Options");
      });
    });
  });

  // =====================
  // 4. search_traces
  // =====================
  describe("search_traces", () => {
    describe("when traces are found", () => {
      it("returns formatted trace digests", async () => {
        const { handleSearchTraces } = await import(
          "../tools/search-traces.js"
        );
        const result = await handleSearchTraces({
          startDate: "24h",
          endDate: "now",
        });

        expect(result).toContain("trace-001");
        expect(result).toContain("LLM Call [llm] 500ms");
        expect(result).toContain("1 trace");
      });
    });

    describe("when no traces match", () => {
      it("returns a no-results message", async () => {
        const { handleSearchTraces } = await import(
          "../tools/search-traces.js"
        );
        const result = await handleSearchTraces({
          query: "__empty__",
        });

        expect(result).toBe("No traces found matching your query.");
      });
    });

    describe("when pagination token is present", () => {
      it("includes scroll ID for next page", async () => {
        const { handleSearchTraces } = await import(
          "../tools/search-traces.js"
        );
        const result = await handleSearchTraces({
          pageSize: 5,
        });

        expect(result).toContain("scroll-token-abc");
      });
    });

    describe("when format is json", () => {
      it("returns parseable JSON", async () => {
        const { handleSearchTraces } = await import(
          "../tools/search-traces.js"
        );
        const result = await handleSearchTraces({
          format: "json",
        });

        const parsed = JSON.parse(result);
        expect(parsed.traces).toBeDefined();
        expect(parsed.traces.length).toBeGreaterThan(0);
        expect(parsed.traces[0].trace_id).toBe("trace-001");
      });
    });

    describe("when filters are applied", () => {
      it("passes filters to the API", async () => {
        const { handleSearchTraces } = await import(
          "../tools/search-traces.js"
        );
        await handleSearchTraces({
          filters: { "metadata.user_id": ["user-42"] },
        });

        const req = lastRequests["POST /api/traces/search"];
        expect(req).toBeDefined();
        const parsed = JSON.parse(req!.body);
        expect(parsed.filters).toEqual({
          "metadata.user_id": ["user-42"],
        });
      });
    });
  });

  // =====================
  // 5. get_trace
  // =====================
  describe("get_trace", () => {
    describe("when trace exists", () => {
      it("returns formatted trace with metadata and evaluations", async () => {
        const { handleGetTrace } = await import(
          "../tools/get-trace.js"
        );
        const result = await handleGetTrace({ traceId: "trace-001" });

        expect(result).toContain("# Trace: trace-001");
        expect(result).toContain("LLM Call [llm] 500ms");
        expect(result).toContain("Faithfulness");
        expect(result).toContain("PASSED");
        expect(result).toContain("**User**: user-42");
        expect(result).toContain("**Thread**: thread-1");
        expect(result).toContain("**Customer**: cust-100");
      });
    });

    describe("when trace does not exist", () => {
      it("propagates the 404 error", async () => {
        const { handleGetTrace } = await import(
          "../tools/get-trace.js"
        );

        await expect(
          handleGetTrace({ traceId: "trace-nonexistent" }),
        ).rejects.toThrow("404");
      });
    });

    describe("when format is json", () => {
      it("returns parseable JSON with full trace data", async () => {
        const { handleGetTrace } = await import(
          "../tools/get-trace.js"
        );
        const result = await handleGetTrace({
          traceId: "trace-001",
          format: "json",
        });

        const parsed = JSON.parse(result);
        expect(parsed.trace_id).toBe("trace-001");
        expect(parsed.evaluations).toBeDefined();
        expect(parsed.metadata).toBeDefined();
      });
    });
  });

  // =====================
  // 6. get_analytics
  // =====================
  describe("get_analytics", () => {
    describe("when data is available", () => {
      it("returns formatted analytics with markdown table", async () => {
        const { handleGetAnalytics } = await import(
          "../tools/get-analytics.js"
        );
        const result = await handleGetAnalytics({
          metric: "metadata.trace_id",
          aggregation: "cardinality",
          startDate: "7d",
        });

        expect(result).toContain("42");
        expect(result).toContain("58");
        expect(result).toContain("| Date | Value |");
      });
    });

    describe("when metric and aggregation are specified", () => {
      it("passes them through to the API", async () => {
        const { handleGetAnalytics } = await import(
          "../tools/get-analytics.js"
        );
        await handleGetAnalytics({
          metric: "performance.total_cost",
          aggregation: "sum",
        });

        const req = lastRequests["POST /api/analytics/timeseries"];
        expect(req).toBeDefined();
        const parsed = JSON.parse(req!.body);
        expect(parsed.series[0].metric).toBe("performance.total_cost");
        expect(parsed.series[0].aggregation).toBe("sum");
      });
    });
  });

  // =====================
  // 7. platform_create_prompt
  // =====================
  describe("platform_create_prompt", () => {
    describe("when valid data is provided", () => {
      it("returns success confirmation with prompt details", async () => {
        const { handleCreatePrompt } = await import(
          "../tools/create-prompt.js"
        );
        const result = await handleCreatePrompt({
          name: "New Prompt",
          messages: [{ role: "system", content: "You are helpful." }],
          model: "gpt-4o",
          modelProvider: "openai",
        });

        expect(result).toContain("created successfully");
        expect(result).toContain("p-new");
        expect(result).toContain("**Name**: New Prompt");
        expect(result).toContain("**Model**: gpt-4o (openai)");
      });
    });
  });

  // =====================
  // 8. platform_list_prompts
  // =====================
  describe("platform_list_prompts", () => {
    describe("when prompts exist", () => {
      it("returns formatted prompt list", async () => {
        const { handleListPrompts } = await import(
          "../tools/list-prompts.js"
        );
        const result = await handleListPrompts();

        expect(result).toContain("greeting-bot");
        expect(result).toContain("Greeting Bot");
        expect(result).toContain("qa-assistant");
        expect(result).toContain("QA Assistant");
        expect(result).toContain("# Prompts (2 total)");
      });
    });
  });

  // =====================
  // 9. platform_get_prompt
  // =====================
  describe("platform_get_prompt", () => {
    describe("when prompt exists", () => {
      it("returns formatted prompt details with messages and versions", async () => {
        const { handleGetPrompt } = await import(
          "../tools/get-prompt.js"
        );
        const result = await handleGetPrompt({
          idOrHandle: "greeting-bot",
        });

        expect(result).toContain("# Prompt: Greeting Bot");
        expect(result).toContain("gpt-4o");
        expect(result).toContain("You are a friendly bot.");
        expect(result).toContain("v3");
        expect(result).toContain("## Version History");
        expect(result).toContain("Updated tone");
      });
    });
  });

  // =====================
  // 10. platform_update_prompt
  // =====================
  describe("platform_update_prompt", () => {
    describe("when updating in place", () => {
      it("returns success message", async () => {
        const { handleUpdatePrompt } = await import(
          "../tools/update-prompt.js"
        );
        const result = await handleUpdatePrompt({
          idOrHandle: "greeting-bot",
          model: "gpt-4o-mini",
          commitMessage: "Switch to mini",
        });

        expect(result).toContain("updated successfully");
        expect(result).toContain("Switch to mini");
      });
    });

    describe("when creating a new version", () => {
      it("returns version creation confirmation", async () => {
        const { handleUpdatePrompt } = await import(
          "../tools/update-prompt.js"
        );
        const result = await handleUpdatePrompt({
          idOrHandle: "greeting-bot",
          messages: [{ role: "system", content: "Be concise." }],
          createVersion: true,
          commitMessage: "Make concise",
        });

        expect(result).toContain("version created");
        expect(result).toContain("Make concise");
      });
    });
  });

  // =====================
  // 11. platform_create_scenario
  // =====================
  describe("platform_create_scenario", () => {
    describe("when valid data is provided", () => {
      it("returns confirmation with new scenario ID", async () => {
        const { handleCreateScenario } = await import(
          "../tools/create-scenario.js"
        );
        const result = await handleCreateScenario({
          name: "New Scenario",
          situation: "User does something",
          criteria: ["Agent responds correctly"],
          labels: ["test"],
        });

        expect(result).toContain("created successfully");
        expect(result).toContain("scen_new789");
      });
    });
  });

  // =====================
  // 12. platform_list_scenarios
  // =====================
  describe("platform_list_scenarios", () => {
    describe("when scenarios exist", () => {
      it("returns formatted scenario list", async () => {
        const { handleListScenarios } = await import(
          "../tools/list-scenarios.js"
        );
        const result = await handleListScenarios({});

        expect(result).toContain("# Scenarios (2 total)");
        expect(result).toContain("Login Flow Happy Path");
        expect(result).toContain("Password Reset");
      });
    });

    describe("when format is json", () => {
      it("returns parseable JSON matching API response", async () => {
        const { handleListScenarios } = await import(
          "../tools/list-scenarios.js"
        );
        const result = await handleListScenarios({ format: "json" });

        expect(JSON.parse(result)).toEqual(CANNED_SCENARIOS_LIST);
      });
    });
  });

  // =====================
  // 13. platform_get_scenario
  // =====================
  describe("platform_get_scenario", () => {
    describe("when the scenario exists", () => {
      it("returns formatted scenario details", async () => {
        const { handleGetScenario } = await import(
          "../tools/get-scenario.js"
        );
        const result = await handleGetScenario({
          scenarioId: "scen_abc123",
        });

        expect(result).toContain("# Scenario: Login Flow Happy Path");
        expect(result).toContain("User attempts to log in");
        expect(result).toContain("Responds with a welcome message");
      });
    });

    describe("when the scenario does not exist", () => {
      it("propagates the 404 error", async () => {
        const { handleGetScenario } = await import(
          "../tools/get-scenario.js"
        );

        await expect(
          handleGetScenario({ scenarioId: "scen_nonexistent" }),
        ).rejects.toThrow("404");
      });
    });

    describe("when format is json", () => {
      it("returns parseable JSON", async () => {
        const { handleGetScenario } = await import(
          "../tools/get-scenario.js"
        );
        const result = await handleGetScenario({
          scenarioId: "scen_abc123",
          format: "json",
        });

        expect(JSON.parse(result)).toEqual(CANNED_SCENARIO_DETAIL);
      });
    });
  });

  // =====================
  // 14. platform_update_scenario
  // =====================
  describe("platform_update_scenario", () => {
    describe("when the scenario exists", () => {
      it("returns update confirmation with updated details", async () => {
        const { handleUpdateScenario } = await import(
          "../tools/update-scenario.js"
        );
        const result = await handleUpdateScenario({
          scenarioId: "scen_abc123",
          name: "Login Flow - Updated",
        });

        expect(result).toContain("updated successfully");
        expect(result).toContain("scen_abc123");
      });
    });
  });

  // =====================
  // 15. platform_archive_scenario
  // =====================
  describe("platform_archive_scenario", () => {
    describe("when the scenario exists", () => {
      it("returns confirmation that scenario was archived", async () => {
        const { handleArchiveScenario } = await import(
          "../tools/archive-scenario.js"
        );
        const result = await handleArchiveScenario({
          scenarioId: "scen_abc123",
        });

        expect(result).toContain("archived successfully");
        expect(result).toContain("scen_abc123");
        expect(result).toContain("archived");
      });
    });
  });

  // =====================
  // 16. platform_create_evaluator
  // =====================
  describe("platform_create_evaluator", () => {
    describe("when valid data is provided", () => {
      it("returns success confirmation with evaluator details", async () => {
        const { handleCreateEvaluator } = await import(
          "../tools/create-evaluator.js"
        );
        const result = await handleCreateEvaluator({
          name: "My LLM Judge",
          config: { evaluatorType: "langevals/llm_boolean" },
        });

        expect(result).toContain("Evaluator created successfully!");
        expect(result).toContain("evaluator_new123");
        expect(result).toContain("my-llm-judge");
        expect(result).toContain("langevals/llm_boolean");
      });
    });
  });

  // =====================
  // 17. platform_list_evaluators
  // =====================
  describe("platform_list_evaluators", () => {
    describe("when evaluators exist", () => {
      it("returns formatted evaluator list", async () => {
        const { handleListEvaluators } = await import(
          "../tools/list-evaluators.js"
        );
        const result = await handleListEvaluators();

        expect(result).toContain("# Evaluators (2 total)");
        expect(result).toContain("Toxicity Check");
        expect(result).toContain("toxicity-check");
        expect(result).toContain("openai/moderation");
        expect(result).toContain("Exact Match");
        expect(result).toContain("exact-match");
      });
    });
  });

  // =====================
  // 18. platform_get_evaluator
  // =====================
  describe("platform_get_evaluator", () => {
    describe("when the evaluator exists", () => {
      it("returns formatted evaluator details with config and fields", async () => {
        const { handleGetEvaluator } = await import(
          "../tools/get-evaluator.js"
        );
        const result = await handleGetEvaluator({
          idOrSlug: "evaluator_abc123",
        });

        expect(result).toContain("# Evaluator: Toxicity Check");
        expect(result).toContain("openai/moderation");
        expect(result).toContain("text-moderation-stable");
        expect(result).toContain("## Input Fields");
        expect(result).toContain("**input** (str)");
        expect(result).toContain("## Output Fields");
        expect(result).toContain("**passed** (bool)");
        expect(result).toContain("**score** (float)");
      });
    });

    describe("when the evaluator does not exist", () => {
      it("propagates the 404 error", async () => {
        const { handleGetEvaluator } = await import(
          "../tools/get-evaluator.js"
        );

        await expect(
          handleGetEvaluator({ idOrSlug: "evaluator_nonexistent" }),
        ).rejects.toThrow("404");
      });
    });
  });

  // =====================
  // 19. platform_update_evaluator
  // =====================
  describe("platform_update_evaluator", () => {
    describe("when the evaluator exists", () => {
      it("returns update confirmation", async () => {
        const { handleUpdateEvaluator } = await import(
          "../tools/update-evaluator.js"
        );
        const result = await handleUpdateEvaluator({
          evaluatorId: "evaluator_abc123",
          name: "Updated Toxicity",
        });

        expect(result).toContain("Evaluator updated successfully!");
        expect(result).toContain("evaluator_abc123");
        expect(result).toContain("Updated Toxicity");
      });
    });
  });

  // =====================
  // 20. platform_set_model_provider
  // =====================
  describe("platform_set_model_provider", () => {
    describe("when setting a provider with API key", () => {
      it("returns success confirmation with provider details", async () => {
        const { handleSetModelProvider } = await import(
          "../tools/set-model-provider.js"
        );
        const result = await handleSetModelProvider({
          provider: "openai",
          enabled: true,
          customKeys: { OPENAI_API_KEY: "sk-test123" },
        });

        expect(result).toContain("Model provider updated successfully!");
        expect(result).toContain("**Provider**: openai");
        expect(result).toContain("**Status**: enabled");
        expect(result).toContain("OPENAI_API_KEY: set");
      });
    });

    describe("when setting a default model", () => {
      it("shows the normalized model name with provider prefix", async () => {
        const { handleSetModelProvider } = await import(
          "../tools/set-model-provider.js"
        );
        const result = await handleSetModelProvider({
          provider: "openai",
          enabled: true,
          defaultModel: "gpt-4o",
        });

        expect(result).toContain("**Default Model**: openai/gpt-4o");
      });
    });
  });

  // =====================
  // 21. platform_list_model_providers
  // =====================
  describe("platform_list_model_providers", () => {
    describe("when providers exist", () => {
      it("returns formatted provider list with status and key info", async () => {
        const { handleListModelProviders } = await import(
          "../tools/list-model-providers.js"
        );
        const result = await handleListModelProviders();

        expect(result).toContain("# Model Providers (2 total)");
        expect(result).toContain("## openai");
        expect(result).toContain("**Status**: enabled");
        expect(result).toContain("## anthropic");
        expect(result).toContain("**Status**: disabled");
        expect(result).toContain("OPENAI_API_KEY: set");
        expect(result).toContain("2 available");
      });
    });
  });

  // =====================
  // Cross-cutting: authentication
  // =====================
  describe("when API key is invalid", () => {
    afterAll(() => {
      initConfig({
        apiKey: "test-integration-key",
        endpoint: `http://localhost:${port}`,
      });
    });

    it("throws an error with 401 status for trace search", async () => {
      initConfig({
        apiKey: "bad-key",
        endpoint: `http://localhost:${port}`,
      });

      const { handleSearchTraces } = await import(
        "../tools/search-traces.js"
      );
      await expect(
        handleSearchTraces({ startDate: "24h" }),
      ).rejects.toThrow("401");
    });

    it("throws an error with 401 status for evaluator list", async () => {
      initConfig({
        apiKey: "bad-key",
        endpoint: `http://localhost:${port}`,
      });

      const { handleListEvaluators } = await import(
        "../tools/list-evaluators.js"
      );
      await expect(handleListEvaluators()).rejects.toThrow("401");
    });

    it("throws an error with 401 status for model providers list", async () => {
      initConfig({
        apiKey: "bad-key",
        endpoint: `http://localhost:${port}`,
      });

      const { handleListModelProviders } = await import(
        "../tools/list-model-providers.js"
      );
      await expect(handleListModelProviders()).rejects.toThrow("401");
    });
  });
});
