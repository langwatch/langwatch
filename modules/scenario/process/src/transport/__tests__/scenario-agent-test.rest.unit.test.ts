/**
 * `POST /api/v1/agents/:id/test`, served by scenario at agent's path (R10).
 * @vitest-environment node
 * @see specs/agents/agent-test-run.feature
 */
import type { AgentTestRunResult } from "@langwatch/agent-contract";
import { allRegisteredRoutes } from "@langwatch/api";
import { bindRestMiddleware, canonicalErrorResponse } from "@langwatch/api/rest";
import type { ScenarioApi } from "@langwatch/scenario-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";

import { agentTestCallerKey, scenarioAgentTestRest } from "../scenario-agent-test.rest.ts";
import { createScenarioRestTestRuntime, PROJECT_ID } from "./scenario-rest.harness.ts";

const runResult: AgentTestRunResult = {
  scenarioRunId: "scenariorun_1",
  batchRunId: "batch_1",
  setId: "set_1",
};

async function startTestRun(caller: { viewerUserId: string | null; callerKey: string | null }) {
  const testAgentRun = vi.fn(async () => runResult);
  const { runtime, projectFacts } = createScenarioRestTestRuntime({
    viewerUserId: caller.viewerUserId,
  });
  const mounted = runtime.mount(scenarioAgentTestRest.router(), {
    app: () => createApiFixture<ScenarioApi>({ testAgentRun }),
    onError: canonicalErrorResponse,
    facts: [projectFacts, bindRestMiddleware(agentTestCallerKey, () => caller.callerKey)],
  });
  const response = await mounted.request("http://api.test/api/v1/agents/agent_http/test", {
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
    expect(testAgentRun).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      agentId: "agent_http",
      actor: { id: "user_runner", label: "user", apiKeyId: "pat_1" },
    });
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

  it("is registered as agent's path, served by scenario until it moves", async () => {
    await startTestRun({ viewerUserId: "user_runner", callerKey: null });

    expect(
      allRegisteredRoutes().find((route) => route.path === "/api/v1/agents/:id/test"),
    ).toMatchObject({ sharedPath: { owner: "agent" } });
  });
});
