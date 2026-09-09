/**
 * @vitest-environment node
 * What `POST /api/evaluations/batch/log_results` tells a caller when the write
 * fails. ADR-045 makes an unhandled cause generic.
 */
import { createRestRuntime } from "@langwatch/api/rest";
import type { EvaluationApi } from "@langwatch/evaluation-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import { evaluationsLegacyRest } from "../evaluations-legacy.rest.ts";

const DRIVER_MESSAGE =
  "Can't reach database server at `clickhouse.internal.langwatch:8443` (P1001)";

const PROJECT_ID = "project-1";

/** No route here is expected to throw, so a failure must be legible. */
function mount(logBatchEvaluation: EvaluationApi["logBatchEvaluation"]) {
  const runtime = createRestRuntime({
    identity: {
      authenticate: () => ({
        actor: { type: "user", id: "user-1" },
        scope: { tier: "project", id: PROJECT_ID },
      }),
    },
  });

  const app = runtime.mount(evaluationsLegacyRest.router(), {
    app: () => createApiFixture<EvaluationApi>({ logBatchEvaluation }),
    onError: (error, context) => context.json({ error: String(error) }, 500),
  });

  return (body: unknown) =>
    app.fetch(
      new Request("http://api.test/api/evaluations/batch/log_results", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
}

describe("given the legacy evaluation batch log", () => {
  describe("when the write fails with a driver diagnostic", () => {
    /** @scenario "A legacy evaluation batch failure returns no driver diagnostic" */
    it("answers a generic 500 rather than the store's own message", async () => {
      const post = mount(() => Promise.reject(new Error(DRIVER_MESSAGE)));

      const response = await post({
        experiment_slug: "my-experiment",
        run_id: "run-1",
        dataset: [],
        evaluations: [],
      });

      expect(response.status).toBe(500);
      const body = await response.json();
      expect(JSON.stringify(body)).not.toContain("clickhouse.internal.langwatch");
      expect(body).toEqual({ error: "Internal server error" });
    });
  });

  describe("when the batch names neither an experiment id nor a slug", () => {
    it("refuses it before the write, in the sentence the SDK reads", async () => {
      const post = mount(() => Promise.reject(new Error("the write must not be reached")));

      const response = await post({ run_id: "run-1", dataset: [], evaluations: [] });

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({
        error: "Either experiment_id or experiment_slug is required",
      });
    });
  });

  describe("when the batch is accepted", () => {
    it("answers the acknowledgement, and hands the write the caller's own project", async () => {
      const logged: unknown[] = [];
      const post = mount(async (input) => {
        logged.push(input);
      });

      const response = await post({
        experiment_slug: "my-experiment",
        run_id: "run-1",
        dataset: [],
        evaluations: [],
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ message: "ok" });
      expect(logged).toHaveLength(1);
      expect((logged[0] as { projectId: string }).projectId).toBe(PROJECT_ID);
    });
  });
});
