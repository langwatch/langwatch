/**
 * @vitest-environment node
 * The experiment doors refuse a caller the door could not identify before any operation runs.
 */
import { ProjectMissingCredentialsError } from "@langwatch/api";
import {
  bindRestMiddleware,
  canonicalErrorResponse,
  createRestRuntime,
  projectRestFacts,
  UnauthorizedError,
} from "@langwatch/api/rest";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";

import { experimentV3Rest, experimentWorkbenchCredential } from "../experiment-v3.rest.ts";
import type { ExperimentV3RestApi } from "../experiment-v3.rest.ts";
import { experimentWorkbenchRunRest } from "../experiment-workbench-run.rest.ts";

/** The key door as it answers a request carrying neither header it reads. */
function keyDoorOver(app: Partial<ExperimentV3RestApi>) {
  const runtime = createRestRuntime({
    identity: {
      authenticate: ({ request }) => {
        if (!request.headers.get("X-Auth-Token") && !request.headers.get("Authorization")) {
          throw new ProjectMissingCredentialsError();
        }

        return {
          actor: { type: "api_key" as const, id: "key-1" },
          scope: { tier: "project" as const, id: "project-1" },
        };
      },
    },
  });
  const api = createApiFixture<ExperimentV3RestApi>(app, "ExperimentV3RestApi");

  return runtime.mount(experimentV3Rest.router(), {
    app: () => api,
    credential: "project",
    onError: canonicalErrorResponse,
    facts: [
      bindRestMiddleware(projectRestFacts, () => ({
        projectSlug: "acme",
        viewerUserId: null,
        actorId: "key-1",
      })),
      bindRestMiddleware(experimentWorkbenchCredential, () => ({
        kind: "legacyProjectKey" as const,
      })),
    ],
  });
}

describe("given the experiment doors behind an identity door that finds no credential", () => {
  describe("when a runs request carries no API key header", () => {
    /** @scenario "Unauthenticated runs request returns 401" */
    it("refuses at 401 with the missing-credentials code, reaching no operation", async () => {
      const hono = keyDoorOver({});

      const response = await hono.request("/api/experiments/runs?experimentSlug=checkout-flow");

      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({
        code: new ProjectMissingCredentialsError().code,
      });
    });
  });

  describe("when a request carrying no credentials reaches a workbench endpoint", () => {
    /** @scenario "The workbench endpoints refuse an unauthenticated caller" */
    it.each([
      ["GET", "/api/experiments/checkout-eval/workbench-state", undefined],
      ["PUT", "/api/experiments/checkout-eval/workbench-state", "{}"],
      ["GET", "/api/experiments/checkout-eval/versions", undefined],
      ["POST", "/api/experiments/checkout-eval/versions/1/restore", "{}"],
    ])("refuses %s %s at 401 with the missing-credentials code", async (method, path, body) => {
      const hono = keyDoorOver({});

      const response = await hono.request(path, {
        method,
        ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body }),
      });

      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({
        code: new ProjectMissingCredentialsError().code,
      });
    });
  });

  describe("when execute is posted with neither a user session nor a project key", () => {
    /** @scenario "Execution endpoint rejects requests with no session" */
    it("refuses at 401 before the run is started", async () => {
      const executeWorkbenchRun = vi.fn();
      const noSession = () => {
        throw new UnauthorizedError("Please log in");
      };
      const runtime = createRestRuntime({
        identity: { identify: noSession, authenticate: noSession, authorize: noSession },
      });
      const hono = runtime.mount(experimentWorkbenchRunRest.router(), {
        app: () => createApiFixture<ExperimentV3RestApi>({ executeWorkbenchRun }),
        onError: canonicalErrorResponse,
      });

      const response = await hono.request("/api/experiments/execute", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId: "project-1" }),
      });

      expect(response.status).toBe(401);
      expect(executeWorkbenchRun).not.toHaveBeenCalled();
    });
  });
});
