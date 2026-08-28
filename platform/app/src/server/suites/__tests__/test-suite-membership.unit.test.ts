/**
 * The reconcile choke point and the test suite validity guard, against a fake
 * transaction client.
 *
 * @see specs/suites/test-suite-membership-invariant.feature
 * @see specs/suites/test-suites.feature
 */
import { describe, expect, it, vi } from "vitest";
import {
  assertAssignableTestSuite,
  reconcileTestSuiteMembership,
  type TestSuiteMembershipClient,
} from "../test-suite-membership";

function makeTx(overrides?: {
  scenarios?: { id: string }[];
  testSuite?: { id: string } | null;
}): TestSuiteMembershipClient & {
  scenarioFindMany: ReturnType<typeof vi.fn>;
  suiteUpdate: ReturnType<typeof vi.fn>;
  suiteFindFirst: ReturnType<typeof vi.fn>;
  executeRaw: ReturnType<typeof vi.fn>;
} {
  const scenarioFindMany = vi
    .fn()
    .mockResolvedValue(overrides?.scenarios ?? []);
  const suiteUpdate = vi.fn().mockResolvedValue({});
  const suiteFindFirst = vi
    .fn()
    .mockResolvedValue(overrides?.testSuite ?? null);
  const executeRaw = vi.fn().mockResolvedValue(0);
  return {
    scenario: { findMany: scenarioFindMany } as never,
    simulationSuite: {
      update: suiteUpdate,
      findFirst: suiteFindFirst,
    } as never,
    $executeRaw: executeRaw as never,
    scenarioFindMany,
    suiteUpdate,
    suiteFindFirst,
    executeRaw,
  };
}

describe("reconcileTestSuiteMembership", () => {
  describe("when the test suite holds archived and active scenarios", () => {
    /** @scenario "Recomputing membership counts only active scenarios" */
    it("recomputes the member list from active scenarios only", async () => {
      const tx = makeTx({ scenarios: [{ id: "scen_1" }, { id: "scen_2" }] });

      await reconcileTestSuiteMembership({
        projectId: "proj_1",
        testSuiteId: "test_suite_1",
        tx,
      });

      // The lock comes before the read that decides what to write, or a
      // second writer reads the list as it was and overwrites this one.
      expect(tx.executeRaw).toHaveBeenCalled();
      expect(tx.executeRaw.mock.invocationCallOrder[0]!).toBeLessThan(
        tx.scenarioFindMany.mock.invocationCallOrder[0]!,
      );
      expect(tx.scenarioFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            projectId: "proj_1",
            testSuiteId: "test_suite_1",
            archivedAt: null,
          },
        }),
      );
      expect(tx.suiteUpdate).toHaveBeenCalledWith({
        where: { id: "test_suite_1", projectId: "proj_1" },
        data: { scenarioIds: ["scen_1", "scen_2"] },
      });
    });

    /** @scenario "A scenario belongs to exactly one test suite" */
    it("derives membership from the scenario's single testSuiteId, so a scenario is in one test suite only", async () => {
      // The member query filters on testSuiteId equality: a scenario naming test suite A
      // can never be counted into test suite B's recompute.
      const tx = makeTx({ scenarios: [] });

      await reconcileTestSuiteMembership({
        projectId: "proj_1",
        testSuiteId: "test_suite_b",
        tx,
      });

      const where = tx.scenarioFindMany.mock.calls[0]?.[0]?.where;
      expect(where.testSuiteId).toBe("test_suite_b");
      expect(tx.suiteUpdate).toHaveBeenCalledWith({
        where: { id: "test_suite_b", projectId: "proj_1" },
        data: { scenarioIds: [] },
      });
    });
  });
});

describe("assertAssignableTestSuite", () => {
  describe("when the id names an active test suite of the project", () => {
    it("passes", async () => {
      const tx = makeTx({ testSuite: { id: "test_suite_1" } });

      await expect(
        assertAssignableTestSuite({
          projectId: "proj_1",
          testSuiteId: "test_suite_1",
          tx,
        }),
      ).resolves.toBeUndefined();

      expect(tx.suiteFindFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: "test_suite_1",
            projectId: "proj_1",
            kind: "test_suite",
            archivedAt: null,
          },
        }),
      );
    });
  });

  describe("when the id names anything else", () => {
    it("refuses with scenario_test_suite_not_found", async () => {
      const tx = makeTx({ testSuite: null });

      await expect(
        assertAssignableTestSuite({
          projectId: "proj_1",
          testSuiteId: "suite_custom",
          tx,
        }),
      ).rejects.toMatchObject({ code: "scenario_test_suite_not_found" });
    });
  });
});
