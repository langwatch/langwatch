/**
 * @vitest-environment node
 *
 * `agents.testRun`, the "Test agent" mutation: it answers with the run ids
 * so the caller can open the run drawer on the run it just scheduled.
 *
 * @see specs/agents/agent-test-run.feature
 */
import type { AgentTestRunResult } from "@langwatch/scenario-server";
import { initTRPC } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";
import type { AgentApp } from "#app/agent.app";
import { AgentTrpcApi, type AgentTrpcContext } from "../agent.api";

const runResult: AgentTestRunResult = {
  scenarioRunId: "scenariorun_1",
  batchRunId: "batch_1",
};

function harness(testRun = vi.fn().mockResolvedValue(runResult)) {
  const trpc = initTRPC.context<AgentTrpcContext>().create();
  const router = AgentTrpcApi.create(trpc, {
    protected: trpc.procedure,
    policy: () => (procedure) => procedure,
  });

  const agents = { testRun } as unknown as AgentApp;
  const caller = router.createCaller({
    app: { agents },
    actor: () => ({ id: "user_1" }),
    authorize: async () => {},
    can: async () => true,
  });

  return { caller, testRun };
}

describe('"Test agent" is requested for the HTTP agent through the API', () => {
  /** @scenario "The mutation answers with the run ids" */
  it("answers with the scenario run id and the batch run id", async () => {
    const { caller } = harness();

    await expect(
      caller.testRun({ projectId: "project_1", agentId: "agent_http" }),
    ).resolves.toEqual(runResult);
  });
});
