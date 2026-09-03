/**
 * @vitest-environment node
 *
 * Transport-level regression guard for the two scenario adapters that post to
 * nlpgo.
 *
 * Both adapters send their request with a `dispatcher` built by the `undici`
 * npm package, so that undici's own `headersTimeout`/`bodyTimeout` can be
 * raised past its 300s default. That dispatcher can only be given to a `fetch`
 * from the SAME package: Node's global `fetch` is bound to the undici bundled
 * with the Node runtime (7.29.0 on Node 24), which builds a request handler of
 * a different shape, and the npm undici (8.x) rejects it immediately with
 * `InvalidArgumentError: invalid onRequestStart method`. Every agent call then
 * failed in about a second, before a byte reached the network.
 *
 * The rest of the adapter suites mock `fetch`, so a mismatch between the fetch
 * and the dispatcher is invisible to them - that is exactly how the fault
 * reached production. This file mocks NO part of the transport: real undici,
 * real dispatcher, real sockets, against a real loopback server.
 */

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { type AgentInput, AgentRole } from "@langwatch/scenario";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { closeNlpFetchDispatchers } from "../adapters/nlp-fetch.adapter";
import type { CodeAgentData, WorkflowAgentData } from "@langwatch/scenario-contract";

// Tracing is not the boundary under test, and the real tracer would need a
// configured exporter. undici and the global fetch are deliberately left alone.
vi.mock("langwatch", () => ({
  getLangWatchTracer: () => ({
    withActiveSpan: async (
      _name: string,
      _opts: unknown,
      fn: (span: {
        setAttribute: () => void;
        setAttributes: () => void;
        setStatus: () => void;
        recordException: () => void;
        end: () => void;
      }) => unknown,
    ) =>
      await fn({
        setAttribute: () => void 0,
        setAttributes: () => void 0,
        setStatus: () => void 0,
        recordException: () => void 0,
        end: () => void 0,
      }),
  }),
}));

vi.mock("@langwatch/observability/tracing", () => ({
  injectTraceContextHeaders: ({ headers }: { headers: Record<string, string> }) => ({
    headers,
    traceId: undefined,
  }),
}));

import { SerializedCodeAgentAdapter } from "../adapters/serialized-code-agent.adapter";
import { SerializedWorkflowAgentAdapter } from "../adapters/serialized-workflow-agent.adapter";

/** Bodies the fake nlpgo received, so the request itself can be asserted on. */
const receivedBodies: string[] = [];

let server: Server;
let nlpServiceUrl: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      receivedBodies.push(body);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          trace_id: "trace_abc123",
          status: "success",
          result: { output: "pong" },
          nodes: {},
        }),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  nlpServiceUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await closeNlpFetchDispatchers();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

afterEach(() => {
  receivedBodies.length = 0;
});

const input: AgentInput = {
  threadId: "thread_123",
  messages: [{ role: "user", content: "ping" }],
  newMessages: [{ role: "user", content: "ping" }],
  requestedRole: AgentRole.AGENT,
  scenarioState: {} as AgentInput["scenarioState"],
  scenarioConfig: {} as AgentInput["scenarioConfig"],
};

describe("given a dispatcher built by the undici package", () => {
  describe("when the code agent adapter calls nlpgo", () => {
    const config: CodeAgentData = {
      type: "code",
      agentId: "agent_123",
      code: 'def execute(input):\n    return "pong"',
      inputs: [{ identifier: "input", type: "str" }],
      outputs: [{ identifier: "output", type: "str" }],
      secrets: {},
    };

    /** @scenario "A code agent turn reaches the NLP service" */
    it("reaches the service and returns its output", async () => {
      const adapter = new SerializedCodeAgentAdapter({
        config,
        nlpServiceUrl,
        projectApiKey: "test-api-key",
      });

      await expect(adapter.call(input)).resolves.toBe("pong");
    });

    /** @scenario "A code agent turn reaches the NLP service" */
    it("sends the execute_flow event the service expects", async () => {
      const adapter = new SerializedCodeAgentAdapter({
        config,
        nlpServiceUrl,
        projectApiKey: "test-api-key",
      });

      await adapter.call(input);

      expect(receivedBodies).toHaveLength(1);
      expect(JSON.parse(receivedBodies[0]!).type).toBe("execute_flow");
    });

    // The agent whose code sleeps past undici's 300s default is the one the
    // dispatcher exists for, so the long deadline must survive a real request.
    /** @scenario "A code agent with a deadline past undici's own default still reaches the service" */
    it("still reaches the service with a deadline past undici's 300s default", async () => {
      const adapter = new SerializedCodeAgentAdapter({
        config: { ...config, timeoutMs: 615_000 },
        nlpServiceUrl,
        projectApiKey: "test-api-key",
      });

      await expect(adapter.call(input)).resolves.toBe("pong");
    });
  });

  describe("when the workflow agent adapter calls nlpgo", () => {
    const config: WorkflowAgentData = {
      type: "workflow",
      agentId: "agent_456",
      workflowId: "wf_1",
      workflow: {
        workflow_id: "wf_1",
        name: "Greeter",
        nodes: [],
        edges: [],
      },
      inputs: [{ identifier: "input", type: "str" }],
      outputs: [{ identifier: "output", type: "str" }],
      secrets: {},
    };

    /** @scenario "A workflow agent turn reaches the NLP service" */
    it("reaches the service and returns its output", async () => {
      const adapter = new SerializedWorkflowAgentAdapter({
        config,
        nlpServiceUrl,
        projectApiKey: "test-api-key",
      });

      await expect(adapter.call(input)).resolves.toBe("pong");
    });
  });
});
