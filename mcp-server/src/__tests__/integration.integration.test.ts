import { createServer, type Server } from "http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { initConfig } from "../config.js";

// --- Canned responses for each API endpoint ---

const CANNED_TRACES_SEARCH = {
  traces: [
    {
      trace_id: "trace-001",
      formatted_trace: "Root [server] 1200ms\n  LLM Call [llm] 500ms\n    Input: Hello, how are you?\n    Output: I am fine, thank you!",
      input: { value: "Hello, how are you?" },
      output: { value: "I am fine, thank you!" },
      timestamps: { started_at: 1700000000000 },
      metadata: { user_id: "user-42" },
    },
  ],
  pagination: { totalHits: 1 },
};

const CANNED_TRACE_DETAIL = {
  trace_id: "trace-001",
  formatted_trace: "Root [server] 1200ms\n  LLM Call [llm] 500ms\n    Input: Hello\n    Output: Hi there",
  timestamps: {
    started_at: 1700000000000,
    inserted_at: 1700000001000,
  },
  metadata: { user_id: "user-42", thread_id: "thread-1" },
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

// --- Mock HTTP Server ---

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
      res.setHeader("Content-Type", "application/json");

      if (url === "/api/traces/search" && req.method === "POST") {
        res.writeHead(200);
        res.end(JSON.stringify(CANNED_TRACES_SEARCH));
      } else if (
        url.match(/^\/api\/traces\/[^/]+(\?|$)/) &&
        req.method === "GET"
      ) {
        res.writeHead(200);
        res.end(JSON.stringify(CANNED_TRACE_DETAIL));
      } else if (
        url === "/api/analytics/timeseries" &&
        req.method === "POST"
      ) {
        res.writeHead(200);
        res.end(JSON.stringify(CANNED_ANALYTICS));
      } else if (url === "/api/prompts" && req.method === "GET") {
        res.writeHead(200);
        res.end(JSON.stringify(CANNED_PROMPTS_LIST));
      } else if (
        url.match(/^\/api\/prompts\/[^/]+\/versions/) &&
        req.method === "POST"
      ) {
        res.writeHead(200);
        res.end(JSON.stringify(CANNED_PROMPT_UPDATED));
      } else if (url.match(/^\/api\/prompts\/[^/]+$/) && req.method === "GET") {
        res.writeHead(200);
        res.end(JSON.stringify(CANNED_PROMPT_DETAIL));
      } else if (url === "/api/prompts" && req.method === "POST") {
        res.writeHead(200);
        res.end(JSON.stringify(CANNED_PROMPT_CREATED));
      } else if (
        url.match(/^\/api\/prompts\/[^/]+$/) &&
        req.method === "POST"
      ) {
        res.writeHead(200);
        res.end(JSON.stringify(CANNED_PROMPT_UPDATED));
      } else {
        res.writeHead(404);
        res.end(
          JSON.stringify({ message: `Not found: ${req.method} ${url}` })
        );
      }
    });
  });
}

// --- Integration Tests ---

describe("MCP tools integration", () => {
  let server: Server;
  let port: number;

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
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  describe("search_traces", () => {
    it("returns formatted trace digests from mock server", async () => {
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

  describe("get_trace", () => {
    it("returns formatted trace digest from mock server", async () => {
      const { handleGetTrace } = await import("../tools/get-trace.js");
      const result = await handleGetTrace({ traceId: "trace-001" });
      expect(result).toContain("trace-001");
      expect(result).toContain("LLM Call [llm] 500ms");
      expect(result).toContain("Faithfulness");
      expect(result).toContain("PASSED");
    });
  });

  describe("get_analytics", () => {
    it("returns formatted analytics data from mock server", async () => {
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
    });
  });

  describe("platform_list_prompts", () => {
    it("returns formatted prompt list from mock server", async () => {
      const { handleListPrompts } = await import("../tools/list-prompts.js");
      const result = await handleListPrompts();
      expect(result).toContain("greeting-bot");
      expect(result).toContain("Greeting Bot");
      expect(result).toContain("qa-assistant");
    });
  });

  describe("platform_get_prompt", () => {
    it("returns formatted prompt details from mock server", async () => {
      const { handleGetPrompt } = await import("../tools/get-prompt.js");
      const result = await handleGetPrompt({ idOrHandle: "greeting-bot" });
      expect(result).toContain("Greeting Bot");
      expect(result).toContain("gpt-4o");
      expect(result).toContain("You are a friendly bot.");
      expect(result).toContain("v3");
    });
  });

  describe("platform_create_prompt", () => {
    it("returns success message from mock server", async () => {
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
    });
  });

  describe("platform_update_prompt", () => {
    it("returns success message for in-place update from mock server", async () => {
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

    it("returns success message for version creation from mock server", async () => {
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

  describe("when API key is invalid", () => {
    afterAll(() => {
      initConfig({
        apiKey: "test-integration-key",
        endpoint: `http://localhost:${port}`,
      });
    });

    it("throws an error with 401 status", async () => {
      initConfig({
        apiKey: "bad-key",
        endpoint: `http://localhost:${port}`,
      });

      const { handleSearchTraces } = await import(
        "../tools/search-traces.js"
      );
      await expect(
        handleSearchTraces({ startDate: "24h" })
      ).rejects.toThrow("401");
    });
  });
});
