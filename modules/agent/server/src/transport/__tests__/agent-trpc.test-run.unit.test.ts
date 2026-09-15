/**
 * @vitest-environment node
 * @see specs/agents/agent-test-run.feature
 */
import type { AgentApi, AgentTestRunResult } from "@langwatch/agent-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";
import { agentTrpcTransport } from "../agent.trpc.ts";
import { agentTrpcCaller } from "./agent-trpc.fixture.ts";

const runResult: AgentTestRunResult = {
  scenarioRunId: "scenariorun_1",
  batchRunId: "batch_1",
  setId: "set_1",
};

function harness(testRun = vi.fn().mockResolvedValue(runResult)) {
  const app = createApiFixture<AgentApi>({ testRun });
  const caller = agentTrpcCaller({ declaration: agentTrpcTransport, app });

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
