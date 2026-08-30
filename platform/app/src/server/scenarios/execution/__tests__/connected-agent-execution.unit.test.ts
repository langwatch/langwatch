/**
 * @vitest-environment node
 *
 * The execution side of a connected agent: the child's adapter, the registry
 * factory, the prefetched job data and the failure classification.
 *
 * @see specs/agents/connected-agents.feature
 */

import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_CALL_TIMEOUT_MS,
  MAX_CALL_TIMEOUT_MS,
} from "~/server/connected-agents/constants";
import {
  classifyScenarioInfraError,
  ScenarioInfraErrorCode,
  scenarioErrorTitle,
} from "../../scenario-infra-error";
import {
  type DataPrefetcherDependencies,
  prefetchScenarioData,
} from "../data-prefetcher";
import { buildRemoteTraceRunConfig } from "../remote-trace-run-config";
import { createAdapter } from "../serialized-adapter.registry";
import {
  ConnectedAgentCallError,
  SerializedConnectedAgentAdapter,
  type ServedInstance,
} from "../serialized-adapters/connected-agent.adapter";
import type { ConnectedAgentData, ExecutionContext } from "../types";

vi.mock("~/env.mjs", () => ({
  env: {
    LANGWATCH_NLP_SERVICE: "http://langwatch_nlp:5561",
    LANGWATCH_ENDPOINT: "http://app:5560",
    CREDENTIALS_SECRET: "11".repeat(32),
  },
}));

const config: ConnectedAgentData = {
  type: "connected",
  agentId: "agent_connected",
  endpoint: "http://app:5560/",
  timeoutMs: 1_000,
};

type Sent = { url: string; headers: Record<string, string>; body: unknown };

function relayReply(payload: unknown, status = 200, retryAfter?: string) {
  return {
    ok: status < 400,
    status,
    headers: {
      get: (name: string) =>
        name.toLowerCase() === "retry-after" ? (retryAfter ?? null) : null,
    },
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  };
}

function fakeRelay(replies: Array<ReturnType<typeof relayReply>>): {
  sent: Sent[];
  fetchImpl: NonNullable<AdapterOptions["fetchImpl"]>;
} {
  const sent: Sent[] = [];
  const queue = [...replies];
  return {
    sent,
    fetchImpl: async (url, init) => {
      sent.push({ url, headers: init.headers, body: JSON.parse(init.body) });
      const next = queue.shift();
      if (!next) throw new Error("no reply queued");
      return next;
    },
  };
}

type AdapterOptions = ConstructorParameters<
  typeof SerializedConnectedAgentAdapter
>[0];

function adapterWith(
  relay: ReturnType<typeof fakeRelay>,
  extra: Partial<AdapterOptions> = {},
) {
  return new SerializedConnectedAgentAdapter({
    config,
    projectApiKey: "sk-lw-project",
    fetchImpl: relay.fetchImpl,
    sleep: async () => {},
    logger: silentLogger(),
    ...extra,
  });
}

function silentLogger() {
  const noop = () => {};
  return {
    info: noop,
    warn: noop,
    error: noop,
    debug: noop,
    trace: noop,
    fatal: noop,
    child: () => silentLogger(),
  } as unknown as AdapterOptions["logger"];
}

function turn(threadId: string, text: string) {
  const message = { role: "user" as const, content: text };
  return {
    threadId,
    messages: [message],
    newMessages: [message],
    requestedRole: "Agent" as never,
    scenarioState: {} as never,
    scenarioConfig: {} as never,
  };
}

const okReply = (
  instance: ServedInstance = { hostname: "laptop", label: null },
) => relayReply({ output: "hi", instance });

describe("SerializedConnectedAgentAdapter", () => {
  describe("when the agent answers a turn with a session", () => {
    /** @scenario "The session an agent returns is echoed on the next turn of the thread" */
    it("echoes it on the next turn of that thread and on no other thread", async () => {
      const relay = fakeRelay([
        relayReply({
          output: "one",
          session: { cursor: 7 },
          instance: { hostname: "laptop", label: null },
        }),
        okReply(),
        okReply(),
      ]);
      const adapter = adapterWith(relay);

      await adapter.call(turn("thread_a", "first"));
      await adapter.call(turn("thread_a", "second"));
      await adapter.call(turn("thread_b", "other"));

      expect(relay.sent[0]?.body).toMatchObject({ threadId: "thread_a" });
      expect(relay.sent[0]?.body).not.toHaveProperty("session");
      expect(relay.sent[1]?.body).toMatchObject({
        threadId: "thread_a",
        session: { cursor: 7 },
      });
      expect(relay.sent[2]?.body).not.toHaveProperty("session");
    });
  });

  describe("when it posts a turn", () => {
    it("targets the relay route with the project key and the run parameters", async () => {
      const relay = fakeRelay([okReply()]);
      const adapter = adapterWith(relay, {
        parameters: { model: "gpt-5-mini" },
      });

      const output = await adapter.call(turn("thread_a", "hello"));

      expect(output).toBe("hi");
      expect(relay.sent[0]?.url).toBe(
        "http://app:5560/api/v1/agents/agent_connected/call",
      );
      expect(relay.sent[0]?.headers["X-Auth-Token"]).toBe("sk-lw-project");
      expect(relay.sent[0]?.body).toMatchObject({
        params: { model: "gpt-5-mini" },
        newMessages: [{ role: "user", content: "hello" }],
      });
      expect(adapter.servedInstance).toEqual({
        hostname: "laptop",
        label: null,
      });
    });
  });

  describe("when every instance is busy for a while", () => {
    it("waits the relay's retry delay and posts the turn again", async () => {
      const relay = fakeRelay([
        relayReply({ error: "agent_busy" }, 429, "1"),
        okReply({ hostname: "laptop", label: "blue" }),
      ]);
      const waits: number[] = [];
      const adapter = adapterWith(relay, {
        sleep: async (ms) => {
          waits.push(ms);
        },
      });

      await adapter.call(turn("thread_a", "hello"));

      expect(relay.sent).toHaveLength(2);
      expect(waits).toHaveLength(1);
      expect(waits[0]).toBeGreaterThanOrEqual(1_000);
      expect(waits[0]).toBeLessThan(2_000);
      expect(adapter.servedInstance?.label).toBe("blue");
    });
  });

  describe("when the relay answers with a handled error", () => {
    it("raises a typed error that names the code and the function's own words", async () => {
      const relay = fakeRelay([
        relayReply(
          {
            error: "agent_call_failed",
            message: "agent_call_failed",
            meta: { remoteCode: "ValueError", message: "bad input" },
          },
          502,
        ),
      ]);
      const adapter = adapterWith(relay);

      const failure = await adapter
        .call(turn("thread_a", "hello"))
        .catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(ConnectedAgentCallError);
      const typed = failure as ConnectedAgentCallError;
      expect(typed.code).toBe("agent_call_failed");
      expect(typed.httpStatus).toBe(502);
      expect(typed.message).toBe(
        "Connected agent call failed (agent_call_failed): bad input",
      );
    });
  });
});

describe("createAdapter", () => {
  describe("when the target is a connected agent", () => {
    it("builds the connected adapter with the project key", () => {
      const adapter = createAdapter({
        adapterData: config,
        nlpServiceUrl: "http://langwatch_nlp:5561",
        projectApiKey: "sk-lw-project",
      });

      expect(adapter).toBeInstanceOf(SerializedConnectedAgentAdapter);
    });

    it("refuses to build without the project key", () => {
      expect(() =>
        createAdapter({
          adapterData: config,
          nlpServiceUrl: "http://langwatch_nlp:5561",
        }),
      ).toThrow("Connected adapter requires projectApiKey");
    });
  });
});

describe("buildRemoteTraceRunConfig", () => {
  describe("given a connected target", () => {
    /** @scenario "A connected target is judged from its remote traces" */
    it("fetches remote traces the way it does for an http target", () => {
      const base = {
        traceWaitTimeoutMs: 12_000,
        langwatchEndpoint: "http://app:5560",
        langwatchApiKey: "sk-lw-project",
      };

      expect(
        buildRemoteTraceRunConfig({ ...base, targetType: "connected" }),
      ).toEqual(buildRemoteTraceRunConfig({ ...base, targetType: "http" }));
      expect(
        buildRemoteTraceRunConfig({ ...base, targetType: "connected" }),
      ).toMatchObject({ fetchRemoteTraces: true, traceWaitTimeoutMs: 12_000 });
    });
  });
});

describe("prefetchScenarioData", () => {
  const context: ExecutionContext = {
    projectId: "proj_123",
    scenarioId: "scen_123",
    setId: "set_123",
    batchRunId: "batch_123",
  };

  function connectedAgent(agentConfig: Record<string, unknown>) {
    return {
      id: "agent_connected",
      type: "connected" as const,
      name: "support-bot",
      projectId: "proj_123",
      config: {
        parameters: [],
        sdk: { name: "langwatch", version: "1.0.0", language: "python" },
        ...agentConfig,
      },
      workflowId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      archivedAt: null,
    };
  }

  function depsFor(agent: unknown): DataPrefetcherDependencies {
    return {
      scenarioFetcher: {
        getById: vi.fn().mockResolvedValue({
          id: "scen_123",
          name: "Test Scenario",
          situation: "User asks a question",
          criteria: ["Must respond politely"],
          labels: [],
        }),
      },
      suiteConfigFetcher: { getBySetId: vi.fn().mockResolvedValue(null) },
      promptFetcher: {
        getPromptByIdOrHandle: vi.fn().mockResolvedValue(null),
      },
      agentFetcher: { findById: vi.fn().mockResolvedValue(agent) },
      workflowVersionFetcher: {
        getLatestDsl: vi.fn().mockResolvedValue(null),
      },
      projectFetcher: {
        findUnique: vi.fn().mockResolvedValue({
          apiKey: "test-api-key",
          team: { organizationId: "organization_1" },
        }),
      },
      sandboxKeyMinter: { mint: vi.fn().mockResolvedValue("sk-lw-run") },
      modelParamsProvider: {
        prepare: vi.fn().mockResolvedValue({
          success: true as const,
          params: { api_key: "test-key", model: "openai/gpt-5-mini" },
        }),
      },
      modelResolver: {
        resolve: vi.fn().mockResolvedValue("openai/gpt-5-mini"),
      },
      projectSecretsFetcher: { getSecrets: vi.fn().mockResolvedValue({}) },
      traceWaitBudgetResolver: {
        resolveTraceWaitTimeoutMs: vi.fn().mockResolvedValue(20_000),
      },
    };
  }

  describe("when the target is a connected agent", () => {
    it("hands the child the relay endpoint, the agent id and its capped call budget", async () => {
      const deps = depsFor(
        connectedAgent({ timeoutMs: MAX_CALL_TIMEOUT_MS * 10 }),
      );

      const result = await prefetchScenarioData({
        context,
        target: { type: "connected", referenceId: "agent_connected" },
        deps,
      });

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.adapterData).toEqual({
        type: "connected",
        agentId: "agent_connected",
        endpoint: "http://app:5560",
        timeoutMs: MAX_CALL_TIMEOUT_MS,
      });
      expect(result.data.traceWaitTimeoutMs).toBe(20_000);
    });

    it("uses the platform default budget when the agent declared none", async () => {
      const deps = depsFor(connectedAgent({}));

      const result = await prefetchScenarioData({
        context,
        target: { type: "connected", referenceId: "agent_connected" },
        deps,
      });

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.adapterData).toMatchObject({
        timeoutMs: DEFAULT_CALL_TIMEOUT_MS,
      });
    });
  });
});

describe("classifyScenarioInfraError", () => {
  describe("when the child failed a connected agent call", () => {
    it.each([
      ["agent_offline", ScenarioInfraErrorCode.AgentOffline],
      ["agent_call_timeout", ScenarioInfraErrorCode.AgentCallTimeout],
      ["agent_disconnected", ScenarioInfraErrorCode.AgentDisconnected],
      ["agent_instance_lost", ScenarioInfraErrorCode.AgentInstanceLost],
      ["agent_busy", ScenarioInfraErrorCode.AgentBusy],
    ])("classifies %s under its own code with a title", (relayCode, code) => {
      const result = classifyScenarioInfraError(
        `Child process exited with code 1: Connected agent call failed (${relayCode}): whatever the relay said`,
      );

      expect(result.code).toBe(code);
      expect(result.message).not.toContain("whatever the relay said");
      expect(scenarioErrorTitle(code)).not.toBe("");
    });

    it("keeps the function's own error for agent_call_failed", () => {
      const result = classifyScenarioInfraError(
        "Connected agent call failed (agent_call_failed): KeyError: 'customer'",
      );

      expect(result.code).toBe(ScenarioInfraErrorCode.AgentCallFailed);
      expect(result.message).toBe(
        "The connected agent raised: KeyError: 'customer'",
      );
    });
  });
});
