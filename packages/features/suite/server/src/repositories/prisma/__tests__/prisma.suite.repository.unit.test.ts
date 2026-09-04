/** @vitest-environment node */

/**
 * `resolveDynamicRunMembership`'s row lock.
 *
 * Spec: specs/suites/run-plan-dynamic-scopes.feature
 *
 * A unit test, and named one: Prisma is a stub, so nothing here opens a
 * socket. The raw-SQL guard is asserted as SQL because that is what it is;
 * whether Postgres honours it is the integration lane's question.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaSuiteRepository, type SuiteDatabase } from "../prisma.suite.repository";

function build(
  overrides: {
    scope?: { mode: string; [k: string]: unknown };
  } = {},
) {
  const executeRaw = vi.fn().mockResolvedValue(undefined);
  const findFirst = vi.fn().mockResolvedValue({
    scenarioIds: [],
    scope: overrides.scope ?? { mode: "labels", labels: ["billing"] },
  });
  const update = vi.fn().mockResolvedValue(undefined);
  const findMany = vi.fn().mockResolvedValue([{ id: "scenario_1" }, { id: "scenario_2" }]);

  const transaction = {
    $executeRaw: executeRaw,
    simulationSuite: { findFirst, update },
    scenario: { findMany },
  };

  const database = {
    $transaction: (callback: (tx: typeof transaction) => unknown) => callback(transaction),
  } as unknown as SuiteDatabase;

  return {
    repository: PrismaSuiteRepository.create(database),
    executeRaw,
    findFirst,
    update,
    findMany,
  };
}

/** The tagged-template SQL, collapsed to one line for a stable assertion. */
function rawSqlFrom(executeRaw: ReturnType<typeof vi.fn>): string {
  const strings = executeRaw.mock.calls[0]?.[0] as unknown as string[];
  return strings.join("?").replace(/\s+/g, " ").trim();
}

describe("PrismaSuiteRepository.resolveDynamicRunMembership", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('given a run plan row (kind = "run_plan")', () => {
    /** @scenario "The row lock matches the row the resolution reads" */
    it("locks by id and projectId alone, not by a kind no plan row carries", async () => {
      const { repository, executeRaw } = build();

      await repository.resolveDynamicRunMembership({ id: "suite_1", projectId: "project_1" });

      expect(executeRaw).toHaveBeenCalledTimes(1);
      const sql = rawSqlFrom(executeRaw);
      expect(sql).toContain("FOR UPDATE");
      expect(sql).not.toMatch(/kind/i);
      // The interpolated values are exactly id and projectId, in that order —
      // the same two columns the read below the lock matches on.
      expect(executeRaw.mock.calls[0]?.slice(1)).toEqual(["suite_1", "project_1"]);
    });

    /** @scenario "The resolved set is written back on the plan" */
    it("still reaches the read and write-back that follow the lock", async () => {
      const { repository, findFirst, update } = build();

      const scenarioIds = await repository.resolveDynamicRunMembership({
        id: "suite_1",
        projectId: "project_1",
      });

      expect(findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "suite_1", projectId: "project_1", kind: "run_plan", archivedAt: null },
        }),
      );
      expect(scenarioIds).toEqual(["scenario_1", "scenario_2"]);
      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { scenarioIds: ["scenario_1", "scenario_2"] } }),
      );
    });

    describe("given a scope naming a test suite id", () => {
      /** @scenario "A scope cannot name another project's test suite" */
      it("still queries scenarios scoped to the calling project, regardless of which test suite id the scope names", async () => {
        const { repository, findMany } = build({
          scope: { mode: "test_suites", testSuiteIds: ["test_suite_in_other_project"] },
        });

        await repository.resolveDynamicRunMembership({ id: "suite_1", projectId: "project_1" });

        expect(findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({
              projectId: "project_1",
              testSuiteId: { in: ["test_suite_in_other_project"] },
            }),
          }),
        );
      });
    });
  });
});

/**
 * `.list()` has no `kind` parameter at all — the Prisma `where` hardcodes
 * `kind: "run_plan"`, so there is no way for a caller of this method to ask
 * for test suite rows through it. Test suites are listed through the
 * scenario feature's own `listTestSuites`, not here.
 */
describe("PrismaSuiteRepository.list", () => {
  function buildList() {
    const findMany = vi.fn().mockResolvedValue([]);
    const database = { simulationSuite: { findMany } } as unknown as SuiteDatabase;
    return { repository: PrismaSuiteRepository.create(database), findMany };
  }

  describe("when the caller names no kind of suite", () => {
    /**
     * `run-plans-v1.api.ts` (the v1 list) and `suite.api.ts`'s `list`
     * procedure (the v2 Test Runs list) both resolve to this same
     * `repository.list()`, so a `kind` this hardcodes out of the query is a
     * row neither surface can ever return.
     */
    /** @scenario "A caller that names no kind of suite gets run plans only" */
    /** @scenario "The v1 run plan list holds no test suite rows" */
    /** @scenario "The v2 Test Runs list holds run plans only" */
    it("asks Prisma for run_plan rows only, since kind is not a parameter", async () => {
      const { repository, findMany } = buildList();

      await repository.list({ projectId: "project_1" });

      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ projectId: "project_1", kind: "run_plan" }),
        }),
      );
    });
  });

  describe("when the caller asks for archived rows", () => {
    /** @scenario "Archived run plans are listed only when the caller asks for them" */
    it("leaves archivedAt unfiltered only when includeArchived is set", async () => {
      const { repository, findMany } = buildList();

      await repository.list({ projectId: "project_1" });
      expect(findMany).toHaveBeenLastCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ kind: "run_plan", archivedAt: null }),
        }),
      );

      await repository.list({ projectId: "project_1", includeArchived: true });
      const lastCall = findMany.mock.calls[1]?.[0] as { where: Record<string, unknown> };
      expect(lastCall.where).not.toHaveProperty("archivedAt");
    });
  });
});
