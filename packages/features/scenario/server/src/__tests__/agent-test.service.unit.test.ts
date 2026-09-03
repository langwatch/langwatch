/**
 * @vitest-environment node
 *
 * "Test agent": one turn sent through the same adapter a simulation turn
 * uses, and one scripted run queued with nothing saved.
 *
 * @see specs/agents/agent-test-run.feature
 */
import { AgentOwnerOnlyError, type AgentService, type AgentWithFields } from "@langwatch/agent-contract";
import type { AgentTestOwnershipPort } from "../ports/agent-test-ownership.port";
import { AGENT_TEST_SCENARIO_ID } from "@langwatch/scenario-contract";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentTestService } from "../services/agent-test.service";

const prefetchAgentTestData = vi.fn();
vi.mock("../services/agent-test-prefetch.service", () => ({
  prefetchAgentTestData: (...args: unknown[]) => prefetchAgentTestData(...args),
}));

const createAdapter = vi.fn();
vi.mock("../adapters/serialized-agent-registry.adapter", () => ({
  createAdapter: (...args: unknown[]) => createAdapter(...args),
}));

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

function fakeAgents(namesById: Record<string, string> = {}): AgentService {
  return {
    getNamesByIds: vi.fn().mockResolvedValue(
      Object.entries(namesById).map(([id, name]) => ({ id, name })),
    ),
  } as unknown as AgentService;
}

function fakeOwnership(namesById: Record<string, string>): AgentTestOwnershipPort {
  return {
    assertRunnable: async ({ agents, actor }) => {
      const foreign = agents.find(
        (agent) =>
          agent.type === "connected" && agent.ownerUserId != null && agent.ownerUserId !== actor?.id,
      );
      if (!foreign?.ownerUserId) return;
      throw new AgentOwnerOnlyError({
        agentId: foreign.id,
        agentName: foreign.name,
        ownerUserId: foreign.ownerUserId,
        ownerName: namesById[foreign.ownerUserId] ?? null,
      });
    },
  };
}

function serviceFor(options: { queueRun?: ReturnType<typeof vi.fn>; namesById?: Record<string, string> }) {
  const queueRun = options.queueRun ?? vi.fn().mockResolvedValue(undefined);
  const service = AgentTestService.create({
    agents: fakeAgents(options.namesById),
    projects: { tryGetById: vi.fn().mockResolvedValue(null) } as never,
    workflows: {} as never,
    prompts: {} as never,
    secrets: {} as never,
    modelProviders: {} as never,
    ownership: fakeOwnership(options.namesById ?? {}),
    connectedDispatch: {
      dispatch: vi.fn().mockResolvedValue({
        output: {},
        durationMs: 1,
        instance: { hostname: "host", label: null },
      }),
    } as never,
    simulations: { queueRun } as never,
    config: {
      langwatchEndpoint: "http://app:5560",
      nlpServiceUrl: "http://langwatch_nlp:5561",
      legacyDefaultModel: "openai/gpt-5-mini",
    },
    maxCallTimeoutMs: 300_000,
  });
  return { service, queueRun };
}

const actor = { id: "user_1", label: "user" as const };

beforeEach(() => {
  vi.clearAllMocks();
  prefetchAgentTestData.mockResolvedValue({
    success: true,
    data: { adapterData: {}, nlpServiceUrl: "http://langwatch_nlp:5561" },
    telemetry: { apiKey: "sk-lw-project" },
  });
});

describe("AgentTestService.sendTurn", () => {
  describe("given an HTTP agent that never answers", () => {
    /** @scenario "A turn that outlives the call deadline is failed" */
    it("fails with agent_call_timeout at the platform cap", async () => {
      vi.useFakeTimers();
      createAdapter.mockReturnValue({ call: () => new Promise(() => undefined) });
      const { service } = serviceFor({});

      const pending = service.sendTurn({
        projectId: "proj_1",
        agent: httpAgent(),
        message: "ping",
        actor,
      });
      const rejected = expect(pending).rejects.toMatchObject({ code: "agent_call_timeout" });
      await vi.advanceTimersByTimeAsync(300_010);
      await rejected;

      vi.useRealTimers();
    });
  });

  describe("given an HTTP agent that answers inside the deadline", () => {
    it("answers what the adapter returned", async () => {
      createAdapter.mockReturnValue({ call: () => Promise.resolve("pong") });
      const { service } = serviceFor({});

      const result = await service.sendTurn({
        projectId: "proj_1",
        agent: httpAgent(),
        message: "ping",
        actor,
      });

      expect(result.output).toBe("pong");
      expect(result.instance).toBeNull();
    });
  });
});

describe("AgentTestService.scheduleRun", () => {
  describe("given an http agent", () => {
    /** @scenario "A test run is queued with no scenario saved" */
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
    it("refuses as not available on this deployment yet", async () => {
      const { service, queueRun } = serviceFor({});

      await expect(
        service.scheduleRun({
          projectId: "proj_1",
          agent: httpAgent({
            id: "agent_conn",
            type: "connected",
            environment: "production",
            ownerUserId: null,
            config: { name: "support-agent" } as never,
          }),
          actor,
        }),
      ).rejects.toMatchObject({ code: "agent_test_refused" });
      expect(queueRun).not.toHaveBeenCalled();
    });
  });
});
