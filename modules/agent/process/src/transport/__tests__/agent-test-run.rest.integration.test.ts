/**
 * @vitest-environment node
 * @see specs/agents/agent-test-run.feature
 */
import type { AgentTestRunResult } from "@langwatch/agent-contract";
import { createApiFixture } from "@langwatch/api-fixture";
import type { ScenarioApi } from "@langwatch/scenario-contract";
import { describe, expect, it, vi } from "vitest";

import { buildAgentApps } from "./agent-rest.fixture.ts";

const runResult: AgentTestRunResult = {
  scenarioRunId: "scenariorun_1",
  batchRunId: "batch_1",
  setId: "set_1",
};

async function startTestRun(caller: { viewerUserId: string | null; callerKey: string | null }) {
  const testAgentRun = vi.fn(async () => runResult);
  const api = await buildAgentApps({
    ...caller,
    scenarios: createApiFixture<ScenarioApi>({ testAgentRun }),
  });
  const agent = await api.createAgent();
  const response = await api.v1(`/api/v1/agents/${agent.id}/test`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });

  return { response, testAgentRun };
}

describe("POST /api/v1/agents/:id/test", () => {
  /** @scenario "The REST route schedules the same run" */
  /** @scenario "The REST route starts the run as the caller's person and the key they called with" */
  it("starts the run as the member, naming the key they called with", async () => {
    const { response, testAgentRun } = await startTestRun({
      viewerUserId: "user_runner",
      callerKey: "pat_1",
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(runResult);
    expect(testAgentRun).toHaveBeenCalledWith(
      expect.objectContaining({ actor: { id: "user_runner", label: "user", apiKeyId: "pat_1" } }),
    );
  });

  /** @scenario "The REST route starts the run as the caller's person and the key they called with" */
  it("starts the run with no person for a key that acts as nobody", async () => {
    const { response, testAgentRun } = await startTestRun({
      viewerUserId: null,
      callerKey: "service_key_1",
    });

    expect(response.status).toBe(200);
    expect(testAgentRun).toHaveBeenCalledWith(expect.objectContaining({ actor: undefined }));
  });
});
