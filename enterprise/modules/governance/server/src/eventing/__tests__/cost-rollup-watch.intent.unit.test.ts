import { describe, expect, it, vi } from "vitest";
import type { CostRollupDayComparer, CostRollupDayLook } from "../../app/governance.members.ts";
import {
  COST_ROLLUP_WATCH_MAX_ATTEMPTS,
  CostRollupCheckUnsettledError,
  CostRollupWatchIntent,
} from "../cost-rollup-watch.intent.ts";

const TENANT = "project-governance-1";
const DAY = "2026-09-07";

/**
 * A comparer that answers with the looks it was handed, in order, and records
 * which of them were reported as drift.
 */
class ScriptedComparer implements CostRollupDayComparer {
  readonly costSource = "pulled";
  readonly drifts: number[] = [];
  private index = 0;

  constructor(
    private readonly looks: ReadonlyArray<{ mismatchedCells: number; cellsBehind: number }>,
  ) {}

  compareDay(): Promise<CostRollupDayLook> {
    const scripted = this.looks[Math.min(this.index, this.looks.length - 1)];
    this.index += 1;
    const reported = scripted!.mismatchedCells;
    return Promise.resolve({
      mismatchedCells: scripted!.mismatchedCells,
      cellsBehind: scripted!.cellsBehind,
      lagMs: 1_500,
      reportDrift: () => {
        this.drifts.push(reported);
      },
    });
  }
}

function look({ attempt, comparer }: { attempt: number; comparer: ScriptedComparer }) {
  return CostRollupWatchIntent.create(comparer).execute(
    { tenantId: TENANT, day: DAY, costSource: comparer.costSource },
    { attempt },
  );
}

describe("cost rollup drift is only drift once it has survived every look", () => {
  describe("given the summary and the charges state different money", () => {
    /** @scenario "A disagreement found before the last look is looked at again" */
    it("counts no drift and leaves the comparison to be attempted again", async () => {
      const comparer = new ScriptedComparer([{ mismatchedCells: 2, cellsBehind: 1 }]);

      await expect(look({ attempt: 1, comparer })).rejects.toBeInstanceOf(
        CostRollupCheckUnsettledError,
      );
      expect(comparer.drifts).toEqual([]);
    });

    /** @scenario "A disagreement over a charge older than the summary's newest is looked at again" */
    it("looks again even when the watermarks read level", async () => {
      // A late charge stamped before the newest one already folded cannot
      // move the summary's watermark, so nothing is provably behind — and
      // the disagreement still buys a look rather than an alert.
      const comparer = new ScriptedComparer([{ mismatchedCells: 1, cellsBehind: 0 }]);

      await expect(look({ attempt: 2, comparer })).rejects.toBeInstanceOf(
        CostRollupCheckUnsettledError,
      );
      expect(comparer.drifts).toEqual([]);
    });

    /** @scenario "A disagreement that survives every look is counted and logged" */
    it("counts the drift on the last look and records the comparison as answered", async () => {
      const comparer = new ScriptedComparer([{ mismatchedCells: 3, cellsBehind: 0 }]);

      await expect(
        look({ attempt: COST_ROLLUP_WATCH_MAX_ATTEMPTS, comparer }),
      ).resolves.toBeUndefined();
      expect(comparer.drifts).toEqual([3]);
    });

    /** @scenario "A disagreement the summary settles between looks is never reported" */
    it("reports nothing once the summary has caught up", async () => {
      const comparer = new ScriptedComparer([
        { mismatchedCells: 2, cellsBehind: 2 },
        { mismatchedCells: 0, cellsBehind: 0 },
      ]);

      await expect(look({ attempt: 2, comparer })).rejects.toBeInstanceOf(
        CostRollupCheckUnsettledError,
      );
      await expect(look({ attempt: 3, comparer })).resolves.toBeUndefined();
      expect(comparer.drifts).toEqual([]);
    });
  });

  describe("given the summary holds no row for a charge's cell", () => {
    /** @scenario "A summary row still missing on the last look is counted as drift" */
    it("counts it as drift on the last look rather than letting the row die", async () => {
      const comparer = new ScriptedComparer([{ mismatchedCells: 1, cellsBehind: 1 }]);

      await expect(
        look({ attempt: COST_ROLLUP_WATCH_MAX_ATTEMPTS, comparer }),
      ).resolves.toBeUndefined();
      expect(comparer.drifts).toEqual([1]);
    });
  });

  describe("given the figures agree over a summary that is still folding", () => {
    /** @scenario "Figures that agree over a summary still folding are looked at again" */
    it("leaves the comparison to be attempted again rather than clearing the day", async () => {
      const comparer = new ScriptedComparer([{ mismatchedCells: 0, cellsBehind: 1 }]);

      await expect(look({ attempt: 1, comparer })).rejects.toBeInstanceOf(
        CostRollupCheckUnsettledError,
      );
      expect(comparer.drifts).toEqual([]);
    });
  });

  describe("given the two sides agree and nothing is behind", () => {
    it("answers the comparison without another look", async () => {
      const comparer = new ScriptedComparer([{ mismatchedCells: 0, cellsBehind: 0 }]);
      const compareDay = vi.spyOn(comparer, "compareDay");

      await expect(look({ attempt: 1, comparer })).resolves.toBeUndefined();
      expect(compareDay).toHaveBeenCalledTimes(1);
      expect(comparer.drifts).toEqual([]);
    });
  });
});
