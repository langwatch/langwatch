/**
 * @vitest-environment node
 */
import {
  createAppRestSecurity,
  type AppRestSecurity,
  type RestApiServicePorts,
} from "@langwatch/api/rest";
import { HandledError } from "@langwatch/handled-error";
import type { WorkflowService } from "@langwatch/workflow-contract";
import type { ErrorHandler, MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { describe, expect, it, vi } from "vitest";
import {
  createWorkflowsRestApp,
  type WorkflowEvaluationOutcome,
  type WorkflowRestPorts,
} from "../workflow.api";

const boundaryErrorHandler: ErrorHandler = (error, c) => {
  if (HandledError.isHandled(error)) {
    const serialized = error.serialize();
    return c.json(
      { error: serialized.code, message: error.message, ...serialized.meta },
      serialized.httpStatus as 400,
    );
  }
  if (error instanceof HTTPException) {
    return c.json({ error: error.message }, error.status as 400);
  }
  return c.json({ error: "internal_server_error" }, 500);
};

function testSecurity(): AppRestSecurity {
  const authenticateProject: MiddlewareHandler = async (c, next) => {
    c.set("project", {
      id: "project-1",
      name: "Project One",
      slug: "project-one",
      teamId: "team-1",
      organizationId: "organization-1",
      isPersonal: false,
      ownerUserId: null,
    });
    await next();
  };
  const passthrough = (): MiddlewareHandler => async (_c, next) => next();

  const ports: RestApiServicePorts = {
    appContext: async (_c, next) => next(),
    requestLogger: () => async (_c, next) => next(),
    requestTracer: () => async (_c, next) => next(),
    legacyErrorHandler: boundaryErrorHandler,
    canonicalErrorHandler: boundaryErrorHandler,
    authenticateProject: () => authenticateProject,
    authorizeProjectPermission: passthrough,
    authorizeApiKeyCeiling: passthrough,
    authenticateOrganization: passthrough,
    authorizeOrganizationPermission: passthrough,
    authorizeRouteTeamPermission: passthrough,
    authorizeRouteProjectPermission: passthrough,
    authenticateOrganizationThrowing: passthrough(),
    authorizeOrganizationPermissionThrowing: passthrough,
  } as unknown as RestApiServicePorts;

  return createAppRestSecurity(ports);
}

function buildApi(triggerEvaluation: WorkflowRestPorts["triggerEvaluation"]) {
  const security = testSecurity();
  const workflows = {} as unknown as WorkflowService;
  const ports: WorkflowRestPorts = {
    platformUrl: ({ projectSlug, path }) => `https://app.langwatch.test/${projectSlug}${path}`,
    requireApiKeyPermission: () => async (_c, next) => next(),
    triggerEvaluation,
  };

  const family = createWorkflowsRestApp({ security, workflows: () => workflows, ports });
  return family.hono;
}

const post = (hono: ReturnType<typeof buildApi>, id: string, body: Record<string, unknown> = {}) =>
  hono.request(`/api/workflows/${id}/evaluate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const successOutcome: WorkflowEvaluationOutcome = {
  ok: true,
  runId: "run_1",
  runUrl: "https://app.langwatch.test/project-one/experiments/exp_1?runId=run_1",
  workflowVersionId: "version_1",
  version: "1",
};

describe("POST /api/workflows/:id/evaluate", () => {
  describe("given the workflow has a committed version", () => {
    /** @scenario Triggering an evaluation returns a run id and a results url */
    it("returns a run id and a results url, and the trigger creates the experiment", async () => {
      const triggerEvaluation = vi.fn(async () => successOutcome);
      const hono = buildApi(triggerEvaluation);

      const res = await post(hono, "workflow_1");

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.run_id).toBe("run_1");
      expect(body.run_url).toContain("/experiments/");
      expect(triggerEvaluation).toHaveBeenCalledWith(
        expect.objectContaining({ workflowId: "workflow_1", projectId: "project-1" }),
      );
    });

    /** @scenario The response stays backward compatible */
    it("still carries the evaluated version id and version", async () => {
      const hono = buildApi(vi.fn(async () => successOutcome));

      const res = await post(hono, "workflow_1");

      const body = await res.json();
      expect(body.workflow_version_id).toBe("version_1");
      expect(body.version).toBe("1");
    });

    /** @scenario The latest committed version is evaluated by default */
    it("asks the trigger for no specific version when none is named", async () => {
      const triggerEvaluation = vi.fn(async () => successOutcome);
      const hono = buildApi(triggerEvaluation);

      await post(hono, "workflow_1");

      expect(triggerEvaluation).toHaveBeenCalledWith(
        expect.objectContaining({ versionId: undefined }),
      );
    });

    /** @scenario A specific committed version can be requested */
    it("passes the requested version id to the trigger", async () => {
      const triggerEvaluation = vi.fn(async () => successOutcome);
      const hono = buildApi(triggerEvaluation);

      await post(hono, "workflow_1", { version_id: "version_v1" });

      expect(triggerEvaluation).toHaveBeenCalledWith(
        expect.objectContaining({ versionId: "version_v1" }),
      );
    });

    /** @scenario Caller-supplied parameters are accepted */
    it("passes caller parameters through and starts the run", async () => {
      const triggerEvaluation = vi.fn(async () => successOutcome);
      const hono = buildApi(triggerEvaluation);

      const res = await post(hono, "workflow_1", {
        parameters: { feature_flag: "variant-b" },
      });

      expect(res.status).toBe(200);
      expect(triggerEvaluation).toHaveBeenCalledWith(
        expect.objectContaining({ parameters: { feature_flag: "variant-b" } }),
      );
    });

    /** @scenario Inline data can be evaluated instead of the attached dataset */
    it("passes inline data rows through and starts the run", async () => {
      const triggerEvaluation = vi.fn(async () => successOutcome);
      const hono = buildApi(triggerEvaluation);

      const res = await post(hono, "workflow_1", { data: [{ question: "x" }] });

      expect(res.status).toBe(200);
      expect(triggerEvaluation).toHaveBeenCalledWith(
        expect.objectContaining({ data: [{ question: "x" }] }),
      );
    });

    /** @scenario The endpoint rejects inline data and a dataset id together */
    it("rejects the request before reaching the trigger", async () => {
      const triggerEvaluation = vi.fn(async () => successOutcome);
      const hono = buildApi(triggerEvaluation);

      const res = await post(hono, "workflow_1", {
        data: [{ question: "x" }],
        dataset_id: "dataset_123",
      });

      // The body fails the request schema's mutual-exclusion refine: a
      // canonical 422, not the handler's own 400 refusal (asserted below).
      expect(res.status).toBe(422);
      expect(triggerEvaluation).not.toHaveBeenCalled();
    });
  });

  describe("given the workflow does not exist in the project", () => {
    /** @scenario Unknown workflow returns not found */
    it("returns 404", async () => {
      const hono = buildApi(
        vi.fn(async () => ({ ok: false, status: 404, error: "Workflow not found" })),
      );

      const res = await post(hono, "workflow_elsewhere");

      expect(res.status).toBe(404);
    });
  });

  describe("given the workflow has no committed version", () => {
    /** @scenario A workflow with no committed version cannot be evaluated */
    it("returns 400 explaining a version must be committed first", async () => {
      const hono = buildApi(
        vi.fn(async () => ({
          ok: false,
          status: 400,
          error: "A version must be committed before it can be evaluated",
        })),
      );

      const res = await post(hono, "workflow_1");

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toMatch(/version/i);
    });
  });
});
