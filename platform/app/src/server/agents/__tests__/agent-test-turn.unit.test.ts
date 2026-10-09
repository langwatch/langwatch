/**
 * @vitest-environment node
 *
 * One turn from the Test panel: the call deadline the platform holds every
 * kind of agent to, and the parameter checks a connected agent's overrides
 * go through.
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

const { getConnectedAgentRuntime } = vi.hoisted(() => ({
  getConnectedAgentRuntime: vi.fn(() => {
    throw new Error("no connected agent is reached in these tests");
  }),
}));
vi.mock("~/server/connected-agents/runtime", () => ({
  getConnectedAgentRuntime,
}));

vi.mock("~/server/suites/connected-targets", () => ({
  assertConnectedAgentsRunnable: vi.fn().mockResolvedValue(undefined),
  agentParameterDefinitionsOf: (agent: { config: unknown }) => {
    const config = agent.config as { parameters?: unknown[] } | null;
    return config?.parameters ?? [];
  },
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

/** A connected agent whose code declares one parameter with two options. */
function connectedAgent(): AgentWithFields {
  return {
    ...httpAgent(),
    id: "agent_connected",
    name: "support-agent",
    type: "connected",
    config: {
      parameters: [
        {
          name: "model",
          type: "string",
          options: ["gpt-4", "gpt-5"],
          defaultValue: "gpt-4",
        },
      ],
      sdk: { name: "langwatch", version: "1.0.0", language: "python" },
    },
    environment: "production",
  } as AgentWithFields;
}

function sendConnectedTurn({
  params,
}: {
  params?: Record<string, string | number | boolean>;
} = {}) {
  return sendAgentTestTurn({
    projectId: "proj_1",
    agentId: "agent_connected",
    message: "ping",
    params,
    actor: { id: "user_1", label: "user" },
    deps: {
      readAgent: vi.fn().mockResolvedValue(connectedAgent()),
      users: {} as Pick<PrismaClient, "user">,
    },
  });
}

beforeEach(() => {
  getConnectedAgentRuntime.mockClear();
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

describe("given a connected agent that declares the parameter model", () => {
  describe("when a test turn names a parameter it does not declare", () => {
    /** @scenario "A test turn naming an undeclared parameter is refused" */
    it("is refused as scenario_parameter_unknown before any instance is reached", async () => {
      await expect(
        sendConnectedTurn({ params: { locale: "de" } }),
      ).rejects.toMatchObject({
        code: "scenario_parameter_unknown",
      });
      expect(getConnectedAgentRuntime).not.toHaveBeenCalled();
    });
  });

  describe("when a test turn sets model outside its options", () => {
    /** @scenario "A test turn value outside the declared options is refused" */
    it("is refused as scenario_parameter_option_invalid before any instance is reached", async () => {
      await expect(
        sendConnectedTurn({ params: { model: "gpt-6" } }),
      ).rejects.toMatchObject({ code: "scenario_parameter_option_invalid" });
      expect(getConnectedAgentRuntime).not.toHaveBeenCalled();
    });
  });
});
