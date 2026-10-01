/** @vitest-environment node */
import {
  bindRestMiddleware,
  createRestRuntime,
  type RestErrorHandler,
  principalOfCredential,
  type RestResolvedProjectCredential,
} from "@langwatch/api/rest";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { WorkflowApi } from "@langwatch/workflow-contract";
import { describe, expect, it, vi } from "vitest";

import { workflowRunCallerKey, workflowRunRest } from "../workflow-run.rest.ts";

const renderUnexpected: RestErrorHandler = (error, context) =>
  context.json({ error: String(error) }, 500);

/** The key row the door binds: only an API key principal has one. */
function keyRowOf(credential: RestResolvedProjectCredential): string | null {
  const principal = principalOfCredential(credential);
  return principal?.type === "apiKey" ? principal.id : null;
}

/** A key the project door resolved for user_1. */
function keyCredential(apiKeyId: string): RestResolvedProjectCredential {
  return {
    type: "apiKey",
    apiKeyId,
    userId: "user_1",
    organizationId: "org_1",
    ingestSourceType: null,
    ingestionTemplateId: null,
    project: {
      id: "project_1",
      name: "Acme",
      slug: "acme",
      teamId: "team_1",
      organizationId: "org_1",
      isPersonal: false,
      ownerUserId: null,
    },
  };
}

function mount(
  runSynchronous: WorkflowApi["runSynchronous"],
  caller: { userId: string; credential: RestResolvedProjectCredential } | null = null,
) {
  const runtime = createRestRuntime({
    identity: {
      authenticate: () => ({
        actor: caller ? { type: "user", id: caller.userId } : null,
        scope: { tier: "project", id: "project_1" },
      }),
    },
  });

  return runtime.mount(workflowRunRest.router(), {
    app: () => createApiFixture<WorkflowApi>({ runSynchronous }, "WorkflowApi"),
    credential: "project",
    onError: renderUnexpected,
    facts: [
      bindRestMiddleware(workflowRunCallerKey, () => (caller ? keyRowOf(caller.credential) : null)),
    ],
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

  /** @scenario "A run started with a personal access token holds no more than that token" */
  it("runs as the member and names the key they called with, so the run's key holds no more", async () => {
    const runSynchronous = vi.fn(async () => ({ status: "success" as const }));

    await mount(runSynchronous, { userId: "user_1", credential: keyCredential("pat_1") }).request(
      "/api/workflows/workflow_1/run",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: "hello" }),
      },
    );

    expect(runSynchronous).toHaveBeenCalledWith(
      expect.objectContaining({ principal: { userId: "user_1", callerApiKeyId: "pat_1" } }),
    );
  });

  /** @scenario "A run started with a CLI access token is bounded by the person alone" */
  it("runs as the person and names no key for their access token, which has no key row", async () => {
    const runSynchronous = vi.fn(async () => ({ status: "success" as const }));
    const credential: RestResolvedProjectCredential = {
      type: "cliAccessToken",
      userId: "user_1",
      organizationId: "org_1",
      project: keyCredential("key_1").project,
    };

    const response = await mount(runSynchronous, { userId: "user_1", credential }).request(
      "/api/workflows/workflow_1/run",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: "hello" }),
      },
    );

    expect(response.status).toBe(200);
    expect(runSynchronous).toHaveBeenCalledWith(
      expect.objectContaining({ principal: { userId: "user_1" } }),
    );
  });
});
