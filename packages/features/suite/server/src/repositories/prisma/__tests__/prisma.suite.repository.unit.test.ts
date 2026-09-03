/** @vitest-environment node */

/**
 * `resolveDynamicRunMembership`'s row lock.
 *
 * A unit test, and named one: Prisma is a stub, so nothing here opens a
 * socket. The raw-SQL guard is asserted as SQL because that is what it is;
 * whether Postgres honours it is the integration lane's question.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaSuiteRepository, type SuiteDatabase } from "../prisma.suite.repository";

function build() {
  const executeRaw = vi.fn().mockResolvedValue(undefined);
  const findFirst = vi.fn().mockResolvedValue({
    scenarioIds: [],
    scope: { mode: "labels", labels: ["billing"] },
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

  return { repository: PrismaSuiteRepository.create(database), executeRaw, findFirst, update };
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

  describe("given a run plan row (kind = \"run_plan\")", () => {
    /** @scenario "The row lock matches the row the read that follows it reads" */
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
  });
});
