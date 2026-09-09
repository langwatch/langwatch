/**
 * @vitest-environment node
 * `POST /api/workflows/:id/evaluate` over the runtime a process mounts it on:
 * the statuses and bodies the public API has answered since it shipped.
 */
import {
  bindRestMiddleware,
  createRestRuntime,
  projectRestFacts,
  type RestErrorHandler,
} from "@langwatch/api/rest";
import { HandledError, NotFoundError, ValidationError } from "@langwatch/handled-error";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { WorkflowApi, WorkflowEvaluationStarted } from "@langwatch/workflow-contract";
import { describe, expect, it, vi } from "vitest";

import { createWorkflowRest, workflowEvaluationRunCeiling } from "../workflow.rest.ts";

/** The process's own boundary renderer, reduced to what these tests read back. */
const renderHandled: RestErrorHandler = (error, c) => {
  if (HandledError.isHandled(error)) {
    const serialized = error.serialize();

    return c.json(
      { error: serialized.code, message: error.message, ...serialized.meta },
      serialized.httpStatus as 400,
    );
  }

  return c.json({ error: "internal_server_error" }, 500);
};

const platformUrl = ({ projectSlug, path }: { projectSlug: string; path: string }) =>
  `https://app.langwatch.test/${projectSlug}${path}`;

const started: WorkflowEvaluationStarted = {
  runId: "run_1",
  runUrl: "https://app.langwatch.test/project-one/experiments/exp_1?runId=run_1",
  workflowVersionId: "version_1",
  version: "1",
};

function buildApi(options: {
  triggerEvaluation: WorkflowApi["triggerEvaluation"];
  mayReadRuns?: boolean;
}) {
  const app = createApiFixture<WorkflowApi>(
    { triggerEvaluation: options.triggerEvaluation },
    "WorkflowApi",
  );

  const runtime = createRestRuntime({
    identity: {
      authenticate: () => ({ actor: null, scope: { tier: "project", id: "project-1" } as const }),
    },
  });

  const hono = runtime.mount(createWorkflowRest(platformUrl).router(), {
    app: () => app,
    credential: "projectKey",
    onError: renderHandled,
    facts: [
      bindRestMiddleware(projectRestFacts, () => ({
        projectSlug: "project-one",
        viewerUserId: null,
        actorId: "project-key-1",
      })),
      bindRestMiddleware(workflowEvaluationRunCeiling, () => options.mayReadRuns ?? true),
    ],
  });

  return hono;
}

type MountedFamily = ReturnType<typeof buildApi>;

const post = (hono: MountedFamily, id: string, body: Record<string, unknown> = {}) =>
  hono.fetch(
    new Request(`http://api.test/api/workflows/${id}/evaluate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );

describe("POST /api/workflows/:id/evaluate", () => {
  describe("given the workflow has a committed version", () => {
    /** @scenario Triggering an evaluation returns a run id and a results url */
    it("returns a run id and a results url, and the trigger creates the experiment", async () => {
      const triggerEvaluation = vi.fn<() => Promise<WorkflowEvaluationStarted>>(async () => started);
      const response = await post(buildApi({ triggerEvaluation }), "workflow_1");

      expect(response.status).toBe(200);

      const body = (await response.json()) as Record<string, unknown>;

      expect(body.run_id).toBe("run_1");
      expect(body.run_url).toContain("/experiments/");
      expect(triggerEvaluation).toHaveBeenCalledWith(
        expect.objectContaining({ workflowId: "workflow_1", projectId: "project-1" }),
      );
    });

    /** @scenario The response stays backward compatible */
    it("still carries the evaluated version id and version", async () => {
      const response = await post(
        buildApi({ triggerEvaluation: vi.fn<() => Promise<WorkflowEvaluationStarted>>(async () => started) }),
        "workflow_1",
      );
      const body = (await response.json()) as Record<string, unknown>;

      expect(body.workflow_version_id).toBe("version_1");
      expect(body.version).toBe("1");
    });

    /** @scenario The latest committed version is evaluated by default */
    it("asks the trigger for no specific version when none is named", async () => {
      const triggerEvaluation = vi.fn<() => Promise<WorkflowEvaluationStarted>>(async () => started);

      await post(buildApi({ triggerEvaluation }), "workflow_1");

      expect(triggerEvaluation).toHaveBeenCalledWith(
        expect.objectContaining({ versionId: undefined }),
      );
    });

    /** @scenario A specific committed version can be requested */
    it("passes the requested version id to the trigger", async () => {
      const triggerEvaluation = vi.fn<() => Promise<WorkflowEvaluationStarted>>(async () => started);

      await post(buildApi({ triggerEvaluation }), "workflow_1", { version_id: "version_v1" });

      expect(triggerEvaluation).toHaveBeenCalledWith(
        expect.objectContaining({ versionId: "version_v1" }),
      );
    });

    /** @scenario Caller-supplied parameters are accepted */
    it("passes caller parameters through and starts the run", async () => {
      const triggerEvaluation = vi.fn<() => Promise<WorkflowEvaluationStarted>>(async () => started);
      const response = await post(buildApi({ triggerEvaluation }), "workflow_1", {
        parameters: { feature_flag: "variant-b" },
      });

      expect(response.status).toBe(200);
      expect(triggerEvaluation).toHaveBeenCalledWith(
        expect.objectContaining({ parameters: { feature_flag: "variant-b" } }),
      );
    });

    /** @scenario Inline data can be evaluated instead of the attached dataset */
    it("passes inline data rows through and starts the run", async () => {
      const triggerEvaluation = vi.fn<() => Promise<WorkflowEvaluationStarted>>(async () => started);
      const response = await post(buildApi({ triggerEvaluation }), "workflow_1", {
        data: [{ question: "x" }],
      });

      expect(response.status).toBe(200);
      expect(triggerEvaluation).toHaveBeenCalledWith(
        expect.objectContaining({ data: [{ question: "x" }] }),
      );
    });

    /** @scenario The endpoint rejects inline data and a dataset id together */
    it("rejects the request before reaching the trigger", async () => {
      const triggerEvaluation = vi.fn<() => Promise<WorkflowEvaluationStarted>>(async () => started);
      const response = await post(buildApi({ triggerEvaluation }), "workflow_1", {
        data: [{ question: "x" }],
        dataset_id: "dataset_123",
      });

      // The body fails the request schema's mutual-exclusion refine: a
      // canonical 422, not the handler's own 400 refusal (asserted below).
      expect(response.status).toBe(422);
      expect(triggerEvaluation).not.toHaveBeenCalled();
    });
  });

  describe("given a key that cannot read the run it would start", () => {
    /** @scenario A workflows-only key cannot start a run it could not read */
    it("refuses before the trigger is reached", async () => {
      const triggerEvaluation = vi.fn<() => Promise<WorkflowEvaluationStarted>>(async () => started);
      const response = await post(
        buildApi({ triggerEvaluation, mayReadRuns: false }),
        "workflow_1",
      );

      expect(response.status).toBe(403);
      expect(triggerEvaluation).not.toHaveBeenCalled();
    });
  });

  describe("given the workflow does not exist in the project", () => {
    /** @scenario Unknown workflow returns not found */
    it("returns 404", async () => {
      const response = await post(
        buildApi({
          triggerEvaluation: vi.fn<() => never>(() => {
            throw new NotFoundError("workflow_not_found", "Workflow", "workflow_elsewhere");
          }),
        }),
        "workflow_elsewhere",
      );

      expect(response.status).toBe(404);
    });
  });

  describe("given the workflow has no committed version", () => {
    /** @scenario A workflow with no committed version cannot be evaluated */
    it("returns 400 explaining a version must be committed first", async () => {
      const response = await post(
        buildApi({
          triggerEvaluation: vi.fn<() => never>(() => {
            throw new ValidationError("A version must be committed before it can be evaluated", {
              httpStatus: 400,
            });
          }),
        }),
        "workflow_1",
      );

      expect(response.status).toBe(400);

      const body = (await response.json()) as Record<string, unknown>;

      expect(body.error).toMatch(/version/i);
    });
  });
});
