/**
 * @vitest-environment node
 *
 * Scheduling a "Test agent" run: one queued run, nothing saved, and the
 * refusals that keep an agent that cannot be run from ever being queued.
 *
 * @see specs/agents/agent-test-run.feature
 */

import { describe, expect, it, vi } from "vitest";
import type { DataPrefetcherDependencies } from "~/server/scenarios/execution/data-prefetcher";
import { AGENT_TEST_SCENARIO_ID } from "../../scenarios/agent-test-scenario";
import type { AgentWithFields } from "../agent-fields";
import { type AgentTestRunDeps, scheduleAgentTestRun } from "../agent-test-run";

vi.mock("~/env.mjs", () => ({
  env: {
    LANGWATCH_NLP_SERVICE: "http://langwatch_nlp:5561",
    LANGWATCH_ENDPOINT: "http://app:5560",
    CREDENTIALS_SECRET: "11".repeat(32),
  },
}));

vi.mock("~/server/app-layer/app", () => ({
  getApp: () => {
    throw new Error("the scheduler under test is handed its own deps");
  },
}));

const now = new Date("2026-08-30T10:00:00Z");

function agentRow(overrides: Partial<AgentWithFields> = {}): AgentWithFields {
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
    lastSeenAt: null,
    copiedFromAgentId: null,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
    inputs: [{ identifier: "input", type: "str" }],
    outputs: [{ identifier: "output", type: "str" }],
    ...overrides,
  } as AgentWithFields;
}

function prefetchDeps(
  agent: AgentWithFields | null,
): DataPrefetcherDependencies {
  return {
    scenarioFetcher: { getById: vi.fn().mockResolvedValue(null) },
    suiteConfigFetcher: { getBySetId: vi.fn().mockResolvedValue(null) },
    promptFetcher: { getPromptByIdOrHandle: vi.fn().mockResolvedValue(null) },
    agentFetcher: { findById: vi.fn().mockResolvedValue(agent) },
    workflowVersionFetcher: { getLatestDsl: vi.fn().mockResolvedValue(null) },
    projectFetcher: {
      findUnique: vi.fn().mockResolvedValue({
        apiKey: "sk-lw-project",
        team: { organizationId: "org_1" },
      }),
    },
    modelParamsProvider: {
      prepare: vi.fn().mockRejectedValue(new Error("no model may be prepared")),
    },
    modelResolver: {
      resolve: vi.fn().mockRejectedValue(new Error("no model may be resolved")),
    },
    projectSecretsFetcher: { getSecrets: vi.fn().mockResolvedValue({}) },
    traceWaitBudgetResolver: {
      resolveTraceWaitTimeoutMs: vi.fn().mockResolvedValue(30_000),
    },
    sandboxKeyMinter: { mint: vi.fn().mockResolvedValue("sk-lw-run") },
  } as DataPrefetcherDependencies;
}

function depsFor(agent: AgentWithFields | null): AgentTestRunDeps & {
  queueRun: ReturnType<typeof vi.fn>;
} {
  return {
    readAgent: vi.fn().mockResolvedValue(agent),
    users: {
      user: {
        findMany: vi
          .fn()
          .mockResolvedValue([{ id: "user_other", name: "Someone Else" }]),
      },
    } as unknown as AgentTestRunDeps["users"],
    prefetchDeps: () => prefetchDeps(agent),
    queueRun: vi.fn().mockResolvedValue(undefined),
  };
}

const actor = { id: "user_1", label: "user" as const };

describe("scheduleAgentTestRun", () => {
  describe("given an http agent", () => {
    /** @scenario "A test run is queued with no scenario saved" */
    it("queues one run in the agent test set with the agent test scenario id", async () => {
      const deps = depsFor(agentRow());

      const result = await scheduleAgentTestRun({
        projectId: "proj_1",
        agentId: "agent_http",
        actor,
        deps,
      });

      expect(deps.queueRun).toHaveBeenCalledTimes(1);
      const queued = deps.queueRun.mock.calls[0]?.[0];
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
      const deps = depsFor(agentRow());

      await scheduleAgentTestRun({
        projectId: "proj_1",
        agentId: "agent_http",
        actor,
        deps,
      });

      expect(deps.queueRun.mock.calls[0]?.[0]).toMatchObject({
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
      const deps = depsFor(agentRow({ id: "agent_sig", type: "signature" }));

      await expect(
        scheduleAgentTestRun({
          projectId: "proj_1",
          agentId: "agent_sig",
          actor,
          deps,
        }),
      ).rejects.toMatchObject({ code: "agent_test_refused" });
      expect(deps.queueRun).not.toHaveBeenCalled();
    });
  });

  describe("given an agent the run cannot be prepared from", () => {
    /** @scenario "An agent the run cannot be prepared from is refused" */
    it("refuses with the preparation message and queues nothing", async () => {
      const agent = agentRow();
      const deps = depsFor(agent);
      // The agent row is there, but the run's own read of it finds nothing.
      deps.prefetchDeps = () => prefetchDeps(null);

      await expect(
        scheduleAgentTestRun({
          projectId: "proj_1",
          agentId: "agent_http",
          actor,
          deps,
        }),
      ).rejects.toMatchObject({
        code: "agent_test_refused",
        meta: { reason: "HTTP agent agent_http not found" },
      });
      expect(deps.queueRun).not.toHaveBeenCalled();
    });
  });

  describe("given a personal development agent of someone else", () => {
    /** @scenario "A personal development agent of someone else is refused" */
    it("refuses as owner only and queues nothing", async () => {
      const deps = depsFor(
        agentRow({
          id: "agent_dev",
          type: "connected",
          environment: "development",
          ownerUserId: "user_other",
          config: { name: "support-agent", description: "" },
        }),
      );

      await expect(
        scheduleAgentTestRun({
          projectId: "proj_1",
          agentId: "agent_dev",
          actor,
          deps,
        }),
      ).rejects.toMatchObject({
        code: "agent_owner_only",
        meta: { ownerName: "Someone Else" },
      });
      expect(deps.queueRun).not.toHaveBeenCalled();
    });
  });

  describe("given no such agent", () => {
    it("throws not found", async () => {
      const deps = depsFor(null);
      await expect(
        scheduleAgentTestRun({
          projectId: "proj_1",
          agentId: "agent_missing",
          actor,
          deps,
        }),
      ).rejects.toMatchObject({ name: "AgentNotFoundError" });
    });
  });
});
