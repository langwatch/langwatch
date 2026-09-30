/**
 * "Test agent": one turn sent through the same adapter a simulation turn uses,
 * @vitest-environment node
 * @see specs/agents/agent-test-run.feature
 */
import { type AgentApi, type AgentOverview, type AgentWithFields } from "@langwatch/agent-contract";
import { createApiFixture } from "@langwatch/api-fixture";
import { AGENT_TEST_SCENARIO_ID } from "@langwatch/scenario-contract";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentTestTurnChild } from "../app/scenario.app.ts";
import { AgentTestService } from "../services/agent-test.service.ts";

const prefetchAgentTestData = vi.fn();
vi.mock("../services/agent-test-prefetch.service.ts", () => ({
  AgentTestPrefetchService: {
    create: () => ({ prefetch: (...args: unknown[]) => prefetchAgentTestData(...args) }),
  },
}));

/** The turn's child, handed to the service the way the process hands it. */
const runTurn = vi.fn<AgentTestTurnChild["run"]>();

const now = new Date("2026-08-30T10:00:00Z");

function httpAgent(overrides: Partial<AgentWithFields> = {}): AgentWithFields {
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
    ...overrides,
  } as AgentWithFields;
}

function overviewOf(agent: AgentWithFields, status: "online" | "offline"): AgentOverview {
  return {
    ...agent,
    environment: agent.environment ?? null,
    ownerUserId: agent.ownerUserId ?? null,
    hostLabel: agent.hostLabel ?? null,
    lastSeenAt: agent.lastSeenAt ?? null,
    parameters: [],
    owner: null,
    status,
    instances: [],
    selectable: true,
    notSelectableReason: null,
  };
}

function fakeAgents(namesById: Record<string, string> = {}, connected?: AgentOverview) {
  const callConnected = vi.fn<AgentApi["callConnected"]>().mockResolvedValue({
    output: "answer",
    durationMs: 1,
    instance: { instanceId: "instance_1", hostname: "host", label: null },
  });
  const agents = createApiFixture<AgentApi>({
    getNamesByIds: vi
      .fn<AgentApi["getNamesByIds"]>()
      .mockResolvedValue(Object.entries(namesById).map(([id, name]) => ({ id, name }))),
    ownersOf: async () =>
      new Map(Object.entries(namesById).map(([userId, name]) => [userId, { userId, name }])),
    callConnected,
    ...(connected ? { getById: vi.fn<AgentApi["getById"]>().mockResolvedValue(connected) } : {}),
  });
  return { agents, callConnected };
}

function serviceFor(options: {
  queueRun?: ReturnType<typeof vi.fn>;
  namesById?: Record<string, string>;
  connected?: AgentOverview;
}) {
  const queueRun = options.queueRun ?? vi.fn().mockResolvedValue(undefined);
  const { agents, callConnected } = fakeAgents(options.namesById, options.connected);
  const service = AgentTestService.create({
    agents,
    projects: { findById: vi.fn().mockResolvedValue(null) } as never,
    workflows: {} as never,
    prompts: {} as never,
    secrets: {} as never,
    modelProviders: {} as never,
    turns: { run: runTurn },
    nlpTimeouts: { engineCodeBlockTimeoutSeconds: Number.NaN, maxTimeoutMs: 90_000 },
    simulations: { queueRun } as never,
    config: {
      langwatchEndpoint: "http://app:5560",
      nlpServiceUrl: "http://langwatch_nlp:5561",
      legacyDefaultModel: "openai/gpt-5-mini",
    },
    maxCallTimeoutMs: 300_000,
  });
  return { service, queueRun, callConnected };
}

const actor = { id: "user_1", label: "user" as const };

beforeEach(() => {
  vi.clearAllMocks();
  prefetchAgentTestData.mockResolvedValue({
    success: true,
    data: {
      adapterData: {},
      nlpServiceUrl: "http://langwatch_nlp:5561",
      scenario: { labels: ["agent-test"] },
    },
    telemetry: { endpoint: "http://app:5560", apiKey: "sk-lw-project" },
  });
});

describe("AgentTestService.sendTurn", () => {
  it("dispatches connected tests through the composed Agent API with the capped call budget", async () => {
    const { service, callConnected } = serviceFor({});
    const result = await service.sendTurn({
      projectId: "proj_1",
      agent: httpAgent({
        type: "connected",
        config: {
          timeoutMs: 999_999,
          sticky: true,
          parameters: [{ name: "region", type: "string" }],
          sdk: { name: "test-sdk", version: "1.0.0", language: "typescript" },
        },
      }),
      actor,
      message: "hello",
      params: { region: "eu" },
    });

    expect(callConnected).toHaveBeenCalledWith({
      projectId: "proj_1",
      agent: expect.objectContaining({ timeoutMs: 300_000, isSticky: true }),
      call: expect.objectContaining({
        messages: [{ role: "user", content: "hello" }],
        newMessages: [{ role: "user", content: "hello" }],
        params: { region: "eu" },
      }),
    });
    expect(result).toEqual({
      output: "answer",
      durationMs: 1,
      instance: { hostname: "host", label: null },
    });
  });
  describe("given a connected agent that declares a model parameter with options", () => {
    const modelAgent = httpAgent({
      type: "connected",
      environment: "production",
      config: {
        parameters: [{ name: "model", type: "string", options: ["gpt-4", "gpt-5"] }],
        sdk: { name: "test-sdk", version: "1.0.0", language: "typescript" },
      },
    });

    describe("when a turn names a parameter it does not declare", () => {
      /** @scenario "A test turn naming an undeclared parameter is refused" */
      it("is refused as scenario_parameter_unknown and reaches no instance", async () => {
        const { service, callConnected } = serviceFor({});

        await expect(
          service.sendTurn({
            projectId: "proj_1",
            agent: modelAgent,
            actor,
            message: "ping",
            params: { temperature: "0.2" },
          }),
        ).rejects.toMatchObject({ code: "scenario_parameter_unknown" });
        expect(callConnected).not.toHaveBeenCalled();
      });
    });

    describe("when a turn carries a value outside the declared options", () => {
      /** @scenario "A test turn value outside the declared options is refused" */
      it("is refused as scenario_parameter_option_invalid and reaches no instance", async () => {
        const { service, callConnected } = serviceFor({});

        await expect(
          service.sendTurn({
            projectId: "proj_1",
            agent: modelAgent,
            actor,
            message: "ping",
            params: { model: "gpt-6" },
          }),
        ).rejects.toMatchObject({ code: "scenario_parameter_option_invalid" });
        expect(callConnected).not.toHaveBeenCalled();
      });
    });

    describe("when a turn carries a declared option", () => {
      it("sends the turn with that value", async () => {
        const { service, callConnected } = serviceFor({});

        await service.sendTurn({
          projectId: "proj_1",
          agent: modelAgent,
          actor,
          message: "ping",
          params: { model: "gpt-5" },
        });

        expect(callConnected.mock.calls[0]?.[0].call.params).toEqual({ model: "gpt-5" });
      });
    });
  });

  describe("given an HTTP agent that never answers", () => {
    /** @scenario "A turn that outlives the call deadline is failed" */
    it("fails with agent_call_timeout at the platform cap", async () => {
      runTurn.mockResolvedValue({ success: false, error: "no answer", timeoutMs: 300_000 });
      const { service } = serviceFor({});

      const pending = service.sendTurn({
        projectId: "proj_1",
        agent: httpAgent(),
        message: "ping",
        actor,
      });

      await expect(pending).rejects.toMatchObject({ code: "agent_call_timeout" });
      expect(runTurn).toHaveBeenCalledWith(
        expect.objectContaining({
          job: expect.objectContaining({ kind: "agent-test-turn", timeoutMs: 300_000 }),
        }),
      );
    });
  });

  describe("given an HTTP agent that answers inside the deadline", () => {
    it("answers what the child's adapter returned", async () => {
      runTurn.mockResolvedValue({ success: true, output: "pong", durationMs: 12 });
      const { service } = serviceFor({});

      const result = await service.sendTurn({
        projectId: "proj_1",
        agent: httpAgent(),
        message: "ping",
        actor,
      });

      expect(result).toEqual({ output: "pong", durationMs: 12, instance: null });
    });

    it("runs the turn in a child with the project's telemetry and only usable deadlines", async () => {
      runTurn.mockResolvedValue({ success: true, output: "pong", durationMs: 12 });
      const { service } = serviceFor({});

      await service.sendTurn({ projectId: "proj_1", agent: httpAgent(), message: "ping", actor });

      expect(runTurn).toHaveBeenCalledWith({
        job: {
          kind: "agent-test-turn",
          adapterData: {},
          nlpServiceUrl: "http://langwatch_nlp:5561",
          parameters: {},
          message: "ping",
          timeoutMs: 300_000,
          nlpTimeouts: { maxTimeoutMs: 90_000 },
        },
        environment: {
          labels: ["agent-test"],
          telemetry: { endpoint: "http://app:5560", apiKey: "sk-lw-project" },
        },
        logContext: { projectId: "proj_1", scenarioId: AGENT_TEST_SCENARIO_ID },
      });
    });
  });

  describe("given an HTTP agent whose turn fails in the child", () => {
    it("fails with the child's error", async () => {
      runTurn.mockResolvedValue({ success: false, error: "connection refused" });
      const { service } = serviceFor({});

      await expect(
        service.sendTurn({ projectId: "proj_1", agent: httpAgent(), message: "ping", actor }),
      ).rejects.toThrow("connection refused");
    });
  });
});

describe("AgentTestService.scheduleRun", () => {
  describe("given an http agent", () => {
    /** @scenario "A test run is queued with no scenario saved" */
    /** @scenario "An HTTP agent is never offline" */
    it("queues one run in the agent test set with the agent test scenario id", async () => {
      const { service, queueRun } = serviceFor({});

      const result = await service.scheduleRun({ projectId: "proj_1", agent: httpAgent(), actor });

      expect(queueRun).toHaveBeenCalledTimes(1);
      const queued = queueRun.mock.calls[0]?.[0];
      expect(queued).toMatchObject({
        tenantId: "proj_1",
        scenarioId: AGENT_TEST_SCENARIO_ID,
        scenarioSetId: "__internal__proj_1__agent-test",
        scenarioRunId: result.scenarioRunId,
        batchRunId: result.batchRunId,
        target: { type: "http", referenceId: "agent_http" },
      });
      expect(result.setId).toBe("__internal__proj_1__agent-test");
    });

    /** @scenario "The queued run names the agent" */
    it("names the run after the agent and records the target and the actor", async () => {
      const { service, queueRun } = serviceFor({});

      await service.scheduleRun({ projectId: "proj_1", agent: httpAgent(), actor });

      expect(queueRun.mock.calls[0]?.[0]).toMatchObject({
        name: "Test ACME Support Agent",
        metadata: {
          langwatch: {
            targetReferenceId: "agent_http",
            targetType: "http",
            agentTest: true,
            actorId: "user_1",
            actorLabel: "user",
          },
        },
      });
    });
  });

  describe("given a prompt agent", () => {
    /** @scenario "An agent that is not run by scenarios is refused" */
    it("refuses the test and queues nothing", async () => {
      const { service, queueRun } = serviceFor({});

      await expect(
        service.scheduleRun({
          projectId: "proj_1",
          agent: httpAgent({ id: "agent_sig", type: "signature" }),
          actor,
        }),
      ).rejects.toMatchObject({ code: "agent_test_refused" });
      expect(queueRun).not.toHaveBeenCalled();
    });
  });

  describe("given an agent the run cannot be prepared from", () => {
    /** @scenario "An agent the run cannot be prepared from is refused" */
    it("refuses with the preparation message and queues nothing", async () => {
      prefetchAgentTestData.mockResolvedValue({
        success: false,
        error: "HTTP agent agent_http not found",
      });
      const { service, queueRun } = serviceFor({});

      await expect(
        service.scheduleRun({ projectId: "proj_1", agent: httpAgent(), actor }),
      ).rejects.toMatchObject({
        code: "agent_test_refused",
        meta: { reason: expect.stringContaining("agent_http") },
      });
      expect(queueRun).not.toHaveBeenCalled();
    });
  });

  describe("given a personal development agent of someone else", () => {
    /** @scenario "A personal development agent of someone else is refused" */
    it("refuses as owner only and queues nothing", async () => {
      const { service, queueRun } = serviceFor({ namesById: { user_other: "Someone Else" } });

      await expect(
        service.scheduleRun({
          projectId: "proj_1",
          agent: httpAgent({
            id: "agent_dev",
            type: "connected",
            environment: "development",
            ownerUserId: "user_other",
            config: { name: "support-agent" } as never,
          }),
          actor,
        }),
      ).rejects.toMatchObject({
        code: "agent_owner_only",
        meta: { ownerName: "Someone Else" },
      });
      expect(queueRun).not.toHaveBeenCalled();
    });
  });

  describe("given a connected agent nobody else owns", () => {
    const connectedAgent = httpAgent({
      id: "agent_conn",
      type: "connected",
      environment: "production",
      ownerUserId: null,
      config: { name: "support-agent" } as never,
    });

    describe("when a process is connected", () => {
      /** @scenario "An online connected agent is scheduled" */
      it("queues one run against the agent", async () => {
        const { service, queueRun } = serviceFor({
          connected: overviewOf(connectedAgent, "online"),
        });

        await service.scheduleRun({ projectId: "proj_1", agent: connectedAgent, actor });

        expect(queueRun).toHaveBeenCalledTimes(1);
        expect(queueRun.mock.calls[0]?.[0]).toMatchObject({
          target: { type: "connected", referenceId: "agent_conn" },
        });
      });
    });

    describe("when no process is connected", () => {
      /** @scenario "An offline connected agent is refused before a run exists" */
      it("refuses with agent_offline and queues nothing", async () => {
        const { service, queueRun } = serviceFor({
          connected: overviewOf(connectedAgent, "offline"),
        });

        await expect(
          service.scheduleRun({ projectId: "proj_1", agent: connectedAgent, actor }),
        ).rejects.toMatchObject({ code: "agent_offline" });
        expect(queueRun).not.toHaveBeenCalled();
      });
    });
  });
});
