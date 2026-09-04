/**
 * @vitest-environment node
 *
 * Every run started from the app is recorded against the signed-in person.
 *
 * @see specs/scenarios/run-actor-on-runs.feature
 */
import type { SuiteApp } from "#app/suite.app";
import type { SuiteRunResult } from "@langwatch/suite-contract";
import { initTRPC } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";
import { SuiteTrpcApi } from "../suite.api";
import type { SuiteTrpcContext } from "../suite.trpc-context";

const runResult: SuiteRunResult = {
  batchRunId: "batch_1",
  setId: "set_1",
  jobCount: 1,
  skippedArchived: { scenarios: [], targets: [] },
};

function harness(run = vi.fn().mockResolvedValue(runResult)) {
  const trpc = initTRPC.context<SuiteTrpcContext>().create();
  const router = SuiteTrpcApi.create(trpc, {
    protected: trpc.procedure,
    policy: () => (procedure) => procedure,
  });

  const suites = { run } as unknown as SuiteApp;
  const caller = router.createCaller({
    app: { suites },
    actor: () => ({ id: "user_lena" }),
  });

  return { caller, run };
}

describe("the actor of a run started from the app", () => {
  describe("when the run mutation is called", () => {
    /** @scenario "A suite run started in the app records the person who started it" */
    it("records the signed-in person, through the app surface", async () => {
      const { caller, run } = harness();

      await caller.run({
        id: "suite_1",
        projectId: "project_1",
        idempotencyKey: "request_1",
      });

      expect(run).toHaveBeenCalledWith(
        expect.objectContaining({ actor: { id: "user_lena", label: "user" } }),
      );
    });
  });
});
