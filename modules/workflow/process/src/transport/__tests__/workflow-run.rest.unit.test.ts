import { createApiFixture } from "@langwatch/api-fixture";
/** @vitest-environment node */
import { createRestRuntime, type RestErrorHandler } from "@langwatch/api/rest";
import type { WorkflowApi } from "@langwatch/workflow-contract";
import { describe, expect, it, vi } from "vitest";

import { workflowRunRest } from "../workflow-run.rest.ts";

const renderUnexpected: RestErrorHandler = (error, context) =>
  context.json({ error: String(error) }, 500);

function mount(runSynchronous: WorkflowApi["runSynchronous"]) {
  const runtime = createRestRuntime({
    identity: {
      authenticate: () => ({ actor: null, scope: { tier: "project", id: "project_1" } }),
    },
  });

  return runtime.mount(workflowRunRest.router(), {
    app: () => createApiFixture<WorkflowApi>({ runSynchronous }, "WorkflowApi"),
    credential: "project",
    onError: renderUnexpected,
  });
}

describe("the synchronous workflow run routes", () => {
  it("passes only the posted fields as workflow inputs", async () => {
    const runSynchronous = vi.fn(async () => ({ status: "success" as const }));
    const app = mount(runSynchronous);

    const response = await app.request("/api/workflows/workflow_1/version_1/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question: "hello" }),
    });

    expect(response.status).toBe(200);
    expect(runSynchronous).toHaveBeenCalledWith({
      workflowId: "workflow_1",
      versionId: "version_1",
      projectId: "project_1",
      inputs: { question: "hello" },
    });
  });

  it.each([
    "/api/v1/workflows/workflow_1/run",
    "/api/workflows/workflow_1/run",
    "/api/v1/optimization/workflow_1/version_1",
    "/api/optimization/workflow_1/version_1",
  ])("answers the same run at %s", async (path) => {
    const runSynchronous = vi.fn(async () => ({ status: "success" as const }));

    const response = await mount(runSynchronous).request(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question: "hello" }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "success" });
  });
});
