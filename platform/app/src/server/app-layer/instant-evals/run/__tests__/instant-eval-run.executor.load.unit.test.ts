/**
 * What the executor says when it cannot load a run: the run is missing, or the
 * deployment has no LangWatchQL identity to run the statement as. Two causes
 * that used to share one error code, which read as a missing row either way.
 *
 * @see ../instant-eval-run.executor.ts
 * @see ../../../../../../specs/instant-evals/instant-eval-api.feature
 */

import { describe, expect, it, vi } from "vitest";

import type { InstantEvalRunExecutorDependencies } from "../instant-eval-run.executor";
import { loadRun } from "../instant-eval-run.executor";

const PROJECT_ID = "project_load_test";
const RUN_ID = "instanteval_load_test";

const ROW = {
  id: RUN_ID,
  projectId: PROJECT_ID,
  sql: "SELECT TraceId, eval(conversation(ConversationId), 'x') AS annoyed FROM analytics.traces",
  parameters: {},
  questions: [
    { id: "annoyed", function: "eval", kind: "boolean", reads: "probability" },
  ],
  plan: [],
  rowLimit: 1_000,
  tokens: 0,
};

function deps({
  row,
  lwqlKey,
}: {
  row: unknown;
  lwqlKey: string | null;
}): InstantEvalRunExecutorDependencies {
  return {
    runs: { findById: vi.fn(async () => row) } as never,
    projectKey: vi.fn(async () => lwqlKey),
  } as unknown as InstantEvalRunExecutorDependencies;
}

describe("given a run id the project does not hold", () => {
  describe("when the executor loads the run", () => {
    /** @scenario "A deployment with no query identity answers as not enabled" */
    it("reports the run as missing", async () => {
      await expect(
        loadRun({
          deps: deps({ row: null, lwqlKey: "lwql-secret" }),
          projectId: PROJECT_ID,
          runId: RUN_ID,
        }),
      ).rejects.toMatchObject({ code: "instant_eval_not_found" });
    });
  });
});

describe("given a run the project holds on a deployment with no query identity", () => {
  describe("when the executor loads the run", () => {
    /** @scenario "A run whose deployment has no query identity says so, not that the run is gone" */
    it("fails as not enabled rather than claiming the run is gone", async () => {
      const failure = await loadRun({
        deps: deps({ row: ROW, lwqlKey: null }),
        projectId: PROJECT_ID,
        runId: RUN_ID,
      }).catch((error: unknown) => error);

      expect(failure).toMatchObject({ code: "instant_eval_not_enabled" });
      expect(failure).not.toMatchObject({ code: "instant_eval_not_found" });
    });
  });
});

describe("given a run the project holds on a deployment that has one", () => {
  describe("when the executor loads the run", () => {
    /** @scenario "A run whose deployment has no query identity says so, not that the run is gone" */
    it("hands back the row and the caller it runs as", async () => {
      const loaded = await loadRun({
        deps: deps({ row: ROW, lwqlKey: "lwql-secret" }),
        projectId: PROJECT_ID,
        runId: RUN_ID,
      });

      expect(loaded.caller).toEqual({
        id: PROJECT_ID,
        lwqlKey: "lwql-secret",
      });
    });
  });
});
