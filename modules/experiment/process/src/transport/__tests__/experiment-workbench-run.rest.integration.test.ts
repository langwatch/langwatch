/**
 * @vitest-environment node
 * Browser workbench runs receive route authorization before their operation.
 */
import { canonicalErrorResponse, createRestRuntime } from "@langwatch/api/rest";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";

import type { ExperimentV3RestApi } from "../experiment-v3.rest.ts";
import { experimentWorkbenchRunRest } from "../experiment-workbench-run.rest.ts";

describe("the workbench run REST family", () => {
  describe("when the caller lacks evaluations:manage on the body project", () => {
    /** @scenario A browser caller without evaluations:manage cannot abort a run */
    it("refuses before the abort operation runs", async () => {
      const abortWorkbenchRun = vi.fn(async () => ({
        success: true as const,
        runId: "run-1",
        message: "Abort requested" as const,
      }));
      const app = createApiFixture<ExperimentV3RestApi>(
        { abortWorkbenchRun },
        "ExperimentV3RestApi",
      );
      const runtime = createRestRuntime({
        identity: {
          identify: () => ({
            actor: { type: "user" as const, id: "user-1" },
            scope: null,
          }),
          authenticate: () => {
            return {
              actor: { type: "user" as const, id: "user-1" },
              scope: { tier: "project" as const, id: "project-1" },
            };
          },
          authorize: ({ permission, target }) => ({
            permitted:
              permission !== "evaluations:manage" ||
              target.tier !== "project" ||
              target.id !== "project-1",
            organizationRole: null,
          }),
        },
      });
      const hono = runtime.mount(experimentWorkbenchRunRest.router(), {
        app: () => app,
        onError: canonicalErrorResponse,
      });

      const response = await hono.request("/api/experiments/abort", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId: "project-1", runId: "run-1" }),
      });

      expect(response.status).toBe(403);
      expect(abortWorkbenchRun).not.toHaveBeenCalled();
    });
  });
});
