/**
 * What `POST /api/workflows/:workflowId/run` answers when the run does not run.
 * Driven through the mounted family, so the status and body are the real ones.
 * @see specs/run-via-api/run-workflow-typed-errors.feature
 */
import type { AuthzService } from "@langwatch/authz-contract";
import type { WorkflowService } from "@langwatch/workflow-contract";
import { WorkflowNotFoundError, WorkflowNotPublishedError } from "@langwatch/workflow-contract";
import { describe, expect, it, vi } from "vitest";

import { ApiHandlerManagedCredentials } from "../../app/api-handler-managed-credential.ts";
import { REST_AUTH_PROJECT, RestAuthWorld } from "./support/rest-auth.world.ts";
import { mountRestFamily, type MountedRestFamily } from "./support/rest-family.harness.ts";

const PROJECT_KEY = "sk-lw-alpha-workflow-run";
const WORKFLOW_ID = "workflow-1";

function mount(runs: () => never): MountedRestFamily & { run: ReturnType<typeof vi.fn> } {
  const world = RestAuthWorld.create({
    keys: [{ token: PROJECT_KEY, projectId: REST_AUTH_PROJECT.id, apiKeyId: "key-workflow-run" }],
  });
  const run = vi.fn(async () => runs());
  const credentials = ApiHandlerManagedCredentials.create({
    apiKeys: world.apiKeys(),
    authz: {
      hasApiKeyPermission: () => Promise.resolve(true),
      getApiKeyProjectDecision: () => Promise.resolve({ outcome: "allowed" }),
    } as unknown as AuthzService,
  });

  const api = mountRestFamily({
    security: world.security(),
    services: {
      workflowRun: {
        credential: (input) => credentials.authenticate(input),
        workflows: () => ({ run }) as unknown as Pick<WorkflowService, "run">,
      },
    },
  });

  return Object.assign(api, { run });
}

const start = (api: MountedRestFamily): Promise<Response> =>
  api.post(`/api/workflows/${WORKFLOW_ID}/run`, {}, { "x-auth-token": PROJECT_KEY });

describe("given a caller starting a workflow run with a project key", () => {
  describe("when the workflow id names no workflow in the project", () => {
    /** @scenario "Running a nonexistent workflow returns 404" */
    it("answers 404 with the workflow-not-found code", async () => {
      const api = mount(() => {
        throw new WorkflowNotFoundError(WORKFLOW_ID);
      });

      const response = await start(api);

      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toMatchObject({ error: "workflow_not_found" });
    });
  });

  describe("when the workflow was never published", () => {
    /** @scenario "Running a workflow that has never been published returns 422" */
    it("answers 422 saying the workflow is not published", async () => {
      const api = mount(() => {
        throw new WorkflowNotPublishedError(WORKFLOW_ID);
      });

      const response = await start(api);

      expect(response.status).toBe(422);
      await expect(response.json()).resolves.toMatchObject({
        message: "Workflow not published",
      });
    });
  });

  describe("when the run fails with something we cannot name", () => {
    /** @scenario "An untyped runWorkflow error still returns a safe 500, not a leaked message" */
    it("answers a generic 500 that carries nothing from inside", async () => {
      const api = mount(() => {
        throw new Error("db connection refused at 10.0.0.5");
      });

      const response = await start(api);
      const body = await response.json();

      expect(response.status).toBe(500);
      expect(body).toMatchObject({ message: "An unknown error occurred" });
      expect(JSON.stringify(body)).not.toContain("10.0.0.5");
    });
  });
});
