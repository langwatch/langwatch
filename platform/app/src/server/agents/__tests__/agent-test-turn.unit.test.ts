/**
 * @vitest-environment node
 *
 * One turn from the Test panel to an agent that is not connected: the call
 * deadline the platform holds every kind of agent to.
 *
 * @see specs/agents/agent-test-run.feature
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "~/generated/prisma/client";
import { MAX_CALL_TIMEOUT_MS } from "~/server/connected-agents/constants";
import type { AgentWithFields } from "../agent-fields";
import { sendAgentTestTurn } from "../agent-test-turn";

vi.mock("~/env.mjs", () => ({
  env: {
    LANGWATCH_NLP_SERVICE: "http://langwatch_nlp:5561",
    LANGWATCH_ENDPOINT: "http://app:5560",
    CREDENTIALS_SECRET: "11".repeat(32),
  },
}));

vi.mock("~/server/connected-agents/runtime", () => ({
  getConnectedAgentRuntime: () => {
    throw new Error("no connected agent is reached in these tests");
  },
}));

vi.mock("~/server/suites/connected-targets", () => ({
  assertConnectedAgentsRunnable: vi.fn().mockResolvedValue(undefined),
}));

const prefetchScenarioData = vi.fn();
vi.mock("~/server/scenarios/execution/data-prefetcher", () => ({
  prefetchScenarioData: (...args: unknown[]) => prefetchScenarioData(...args),
  createDataPrefetcherDependencies: () => ({}),
}));

const createAdapter = vi.fn();
vi.mock("~/server/scenarios/execution/serialized-adapter.registry", () => ({
  createAdapter: (...args: unknown[]) => createAdapter(...args),
}));

const now = new Date("2026-08-30T10:00:00Z");

function httpAgent(): AgentWithFields {
  return {
    id: "agent_http",
    projectId: "proj_1",
    name: "ACME Support Agent",
    type: "http",
    config: {
      name: "ACME Support Agent",
      url: "https://acme.example/chat",
      method: "POST",
      headers: [],
      bodyTemplate: '{"input": "{{input}}"}',
      outputPath: "$.output",
      inputs: [{ identifier: "input", type: "str" }],
      outputs: [{ identifier: "output", type: "str" }],
    },
    workflowId: null,
    environment: null,
    ownerUserId: null,
    hostLabel: null,
    identityKey: null,
    lastSeenAt: null,
    copiedFromAgentId: null,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
    inputFields: [{ identifier: "input", type: "str" }],
    outputFields: [{ identifier: "output", type: "str" }],
    fieldsResolved: true,
  } as AgentWithFields;
}

function sendTurn() {
  return sendAgentTestTurn({
    projectId: "proj_1",
    agentId: "agent_http",
    message: "ping",
    actor: { id: "user_1", label: "user" },
    deps: {
      readAgent: vi.fn().mockResolvedValue(httpAgent()),
      users: {} as Pick<PrismaClient, "user">,
    },
  });
}

beforeEach(() => {
  prefetchScenarioData.mockResolvedValue({
    success: true,
    data: { adapterData: {}, nlpServiceUrl: "http://langwatch_nlp:5561" },
    telemetry: { apiKey: "sk-lw-project" },
  });
});

describe("given an HTTP agent that never answers", () => {
  describe("when a test turn is sent", () => {
    /** @scenario "A turn that outlives the call deadline is failed" */
    it("fails with agent_call_timeout at the platform cap", async () => {
      vi.useFakeTimers();
      createAdapter.mockReturnValue({
        call: () => new Promise(() => undefined),
      });

      const pending = sendTurn();
      const rejected = expect(pending).rejects.toMatchObject({
        code: "agent_call_timeout",
      });
      await vi.advanceTimersByTimeAsync(MAX_CALL_TIMEOUT_MS + 10);
      await rejected;

      vi.useRealTimers();
    });
  });
});

describe("given an HTTP agent that answers inside the deadline", () => {
  describe("when a test turn is sent", () => {
    it("answers what the adapter returned", async () => {
      createAdapter.mockReturnValue({
        call: () => Promise.resolve("pong"),
      });

      const result = await sendTurn();

      expect(result.output).toBe("pong");
      expect(result.instance).toBeNull();
    });
  });
});
