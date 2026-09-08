/**
 * @vitest-environment node
 * @see specs/scenarios/run-actor-on-runs.feature
 */
import { createTrpcRuntime } from "@langwatch/api/trpc";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { SuiteApi, SuiteRunResult } from "@langwatch/suite-contract";
import { initTRPC } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";

import { suiteTrpcTransport } from "../suite.trpc.ts";
import { suiteTrpcTestPorts, type SuiteTrpcTestContext } from "./suite.trpc.harness.ts";

const runResult: SuiteRunResult = {
  batchRunId: "batch_1",
  setId: "set_1",
  jobCount: 1,
  skippedArchived: { scenarios: [], targets: [] },
  items: [],
};

function harness(run = vi.fn().mockResolvedValue(runResult)) {
  const trpc = initTRPC.context<SuiteTrpcTestContext>().create();
  const app = createApiFixture<SuiteApi>({ run });

  const router = createTrpcRuntime<SuiteTrpcTestContext>({
    root: trpc,
    procedure: trpc.procedure,
    ports: suiteTrpcTestPorts(),
  }).mount(suiteTrpcTransport, () => app);

  return { caller: router.createCaller({ actor: { id: "user_lena" } }), run };
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
