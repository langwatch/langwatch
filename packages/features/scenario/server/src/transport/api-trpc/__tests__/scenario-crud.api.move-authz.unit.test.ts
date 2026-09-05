/**
 * @vitest-environment node
 *
 * `scenarios.moveToTestSuite` is wired to the `scenarios:manage` policy, so a
 * caller who holds only read access is refused before the move ever reaches
 * the application.
 *
 * @see specs/scenarios/scenario-test-suite-assignment.feature
 */
import { initTRPC, TRPCError } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";
import type { ScenarioApp } from "#app/scenario.app";
import { createScenarioCrudRouter } from "../scenario-crud.api";
import type { ScenarioTrpcContext } from "../scenario.trpc-context";

function harness(permitted: boolean) {
  const trpc = initTRPC.context<ScenarioTrpcContext>().create();
  const moveToTestSuite = vi.fn();

  const router = createScenarioCrudRouter(
    trpc,
    {
      protected: trpc.procedure,
      policy: () => (procedure) => {
        if (permitted) return procedure as never;
        return trpc.procedure.use(async () => {
          throw new TRPCError({ code: "FORBIDDEN" });
        }) as never;
      },
    },
    {
      trackScenarioCreated: () => {},
      fireScenarioCreatedNurturing: () => {},
      captureException: () => {},
    },
  );

  const scenarios = { moveToTestSuite } as unknown as ScenarioApp;
  const caller = router.createCaller({
    app: { scenarios },
    actor: () => ({ id: "user_viewer" }),
    signal: undefined,
  });

  return { caller, moveToTestSuite };
}

describe("given a person with read-only access", () => {
  /** @scenario "A person with read-only access cannot move a scenario" */
  it("refuses to move a scenario", async () => {
    const { caller, moveToTestSuite } = harness(false);

    await expect(
      caller.moveToTestSuite({
        projectId: "project_1",
        scenarioId: "scenario_1",
        testSuiteId: "test_suite_1",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    expect(moveToTestSuite).not.toHaveBeenCalled();
  });
});
