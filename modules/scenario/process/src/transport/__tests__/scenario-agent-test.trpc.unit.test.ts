/**
 * @vitest-environment node
 * @see specs/agents/agent-test-run.feature
 */
import { AgentOfflineError, type AgentTestRunResult } from "@langwatch/agent-contract";
import type { ScenarioApi } from "@langwatch/scenario-contract";
import { describe, expect, it, vi } from "vitest";

import { scenarioTrpcTransport } from "../scenario.trpc.ts";
import { scenarioTrpcCaller, stubScenarioApi } from "./scenario-trpc.fixture.ts";

const runResult: AgentTestRunResult = {
  scenarioRunId: "scenariorun_1",
  batchRunId: "batch_1",
  setId: "set_1",
};

function harness(testAgentRun: ScenarioApi["testAgentRun"] = vi.fn(async () => runResult)) {
  return scenarioTrpcCaller({
    declaration: scenarioTrpcTransport,
    app: stubScenarioApi({ testAgentRun }),
    permissions: ["scenarios:create"],
  });
}

describe('"Test agent" is requested for the HTTP agent through the API', () => {
  /** @scenario "The mutation answers with the run ids" */
  it("answers with the scenario run id and the batch run id", async () => {
    const testAgentRun = vi.fn(async () => runResult);
    const { caller } = harness(testAgentRun);

    await expect(
      caller.testAgentRun({ projectId: "project_1", agentId: "agent_http" }),
    ).resolves.toEqual(runResult);
    expect(testAgentRun).toHaveBeenCalledWith({
      projectId: "project_1",
      agentId: "agent_http",
      actor: { id: "user_1", label: "user" },
    });
  });
});

describe('"Test agent" is requested for a connected agent no process holds', () => {
  /** @scenario "The API refuses to test an offline connected agent" */
  it("is refused with agent_offline", async () => {
    const { caller } = harness(
      vi.fn(async () => {
        throw new AgentOfflineError({ agentName: "support-agent", environment: null });
      }),
    );

    await expect(
      caller.testAgentRun({ projectId: "project_1", agentId: "agent_connected" }),
    ).rejects.toMatchObject({ cause: { code: "agent_offline" } });
  });
});

describe("one turn is sent to an agent from its Test panel", () => {
  it("names the agent by id and acts as the caller", async () => {
    const testAgentTurn = vi.fn(async () => ({ output: "hi", durationMs: 1, instance: null }));
    const { caller } = scenarioTrpcCaller({
      declaration: scenarioTrpcTransport,
      app: stubScenarioApi({ testAgentTurn }),
      permissions: ["evaluations:manage"],
    });

    await caller.testAgentTurn({ projectId: "project_1", id: "agent_http", message: "ping" });

    expect(testAgentTurn).toHaveBeenCalledWith({
      projectId: "project_1",
      agentId: "agent_http",
      message: "ping",
      actor: { id: "user_1", label: "user" },
    });
  });

  it("refuses a caller without evaluations:manage", async () => {
    const testAgentTurn = vi.fn();
    const { caller } = scenarioTrpcCaller({
      declaration: scenarioTrpcTransport,
      app: stubScenarioApi({ testAgentTurn }),
      permissions: ["scenarios:create"],
    });

    await expect(
      caller.testAgentTurn({ projectId: "project_1", id: "agent_http", message: "ping" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(testAgentTurn).not.toHaveBeenCalled();
  });
});
