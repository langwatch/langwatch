/**
 * @see specs/features/agent-testing/results-atoms.feature
 */

import { describe, expect, it } from "vitest";
import { ScenarioRunStatus } from "~/server/scenarios/scenario-event.enums";
import { categorizeRunStatus } from "~/server/scenarios/scenario-run-category";
import { mapStatus } from "~/server/simulations/simulation-run.mappers";
import {
  buildAtomFilters,
  DEDUP_WINDOW_SLACK_MS,
  FAILED_STATUS_VALUES,
  groupKeyExpr,
  PASSED_STATUS_VALUES,
  trendKeyExpr,
} from "../atom-sql";

/**
 * Every raw value the Status column is known to hold, including the legacy
 * spelling that mapStatus folds away.
 */
const RAW_STATUS_VALUES = [
  ...Object.values(ScenarioRunStatus),
  "FAILURE",
] as const;

describe("the outcome of a status", () => {
  describe("given every status the column can hold", () => {
    /**
     * The SQL decides a verdict and so does categorizeRunStatus. If they ever
     * disagree, a run reads as passed on the chart and failed in the table, and
     * nothing in a normal test run would say which is correct.
     */
    it("agrees with categorizeRunStatus on every one of them", () => {
      for (const raw of RAW_STATUS_VALUES) {
        const category = categorizeRunStatus(mapStatus(raw));
        const sqlSaysPassed = (PASSED_STATUS_VALUES as readonly string[]).includes(raw);
        const sqlSaysFailed = (FAILED_STATUS_VALUES as readonly string[]).includes(raw);

        if (category === "success") {
          expect(sqlSaysPassed, `${raw} should read as passed`).toBe(true);
          expect(sqlSaysFailed).toBe(false);
        } else if (
          category === "failure" ||
          category === "stalled" ||
          category === "cancelled"
        ) {
          expect(sqlSaysFailed, `${raw} should read as failed`).toBe(true);
          expect(sqlSaysPassed).toBe(false);
        } else {
          expect(sqlSaysPassed, `${raw} should read as pending`).toBe(false);
          expect(sqlSaysFailed, `${raw} should read as pending`).toBe(false);
        }
      }
    });
  });
});

describe("buildAtomFilters", () => {
  const base = { projectId: "proj", startDate: 1_000_000 };

  describe("when no end date is given", () => {
    /**
     * The period picker pins its end at mount, so a live view sends none. An
     * upper bound there would filter on "started before the page loaded" and a
     * run beginning while someone watches would never appear.
     */
    it("bounds the window only from below", () => {
      const filters = buildAtomFilters(base);

      expect(filters.volatileClause).toContain("StartedAt >=");
      expect(filters.volatileClause).not.toContain("StartedAt <=");
      expect(filters.params.atomEndMs).toBeUndefined();
    });
  });

  describe("when an end date is given", () => {
    it("bounds the window at both ends", () => {
      const filters = buildAtomFilters({ ...base, endDate: 2_000_000 });

      expect(filters.volatileClause).toContain("StartedAt <=");
      expect(filters.params.atomEndMs).toBe("2000000");
    });
  });

  describe("the dedup subquery window", () => {
    /**
     * StartedAt moves between versions of one run, so a dedup scope bounded
     * exactly to the window can drop the true latest version out of its own
     * group and resolve to a stale in-window one. The slack is what keeps the
     * subquery pruning partitions without that risk.
     */
    it("reaches a week past the window it prunes for", () => {
      const startDate = Date.UTC(2026, 0, 15);
      const endDate = Date.UTC(2026, 1, 15);
      const filters = buildAtomFilters({ ...base, startDate, endDate });

      expect(filters.params.atomDedupStartMs).toBe(
        String(startDate - DEDUP_WINDOW_SLACK_MS),
      );
      expect(filters.params.atomDedupEndMs).toBe(
        String(endDate + DEDUP_WINDOW_SLACK_MS),
      );
      expect(filters.dedupWindowClause).toContain("atomDedupStartMs");
    });

    it("never reaches before the epoch", () => {
      const filters = buildAtomFilters({ ...base, startDate: 5 });

      expect(filters.params.atomDedupStartMs).toBe("0");
    });
  });

  describe("when the filter names a status", () => {
    /**
     * Status differs between versions of one run, so narrowing on it may only
     * happen after dedup. Inside the subquery it would pick whichever old
     * version still matched.
     */
    it("keeps it out of the clause the dedup subquery uses", () => {
      const filters = buildAtomFilters({ ...base, outcome: "failed" });

      expect(filters.volatileClause).toContain("Status IN");
      expect(filters.stableClause).not.toContain("Status");
    });
  });

  describe("when the filter names scenarios and sets", () => {
    /**
     * A run never moves between sets or scenarios, and ScenarioSetId is part
     * of the dedup key already, so narrowing on them picks the same version
     * either way. Keeping them in the subquery is what stops it grouping over
     * the whole tenant.
     */
    it("puts them where the dedup subquery can use them", () => {
      const filters = buildAtomFilters({
        ...base,
        scenarioIds: ["s1"],
        scenarioSetIds: ["set-1"],
      });

      expect(filters.stableClause).toContain("ScenarioId IN");
      expect(filters.stableClause).toContain("ScenarioSetId IN");
    });
  });

  describe("when the filter names the default set", () => {
    it("expands it to both stored spellings", () => {
      const filters = buildAtomFilters({ ...base, scenarioSetIds: ["default"] });

      expect(filters.params.atomSetIds).toEqual(["default", ""]);
    });
  });
});

describe("the grain of a grouping", () => {
  describe("when grouping by run plan", () => {
    /**
     * A plan row covers many scenarios, so one scenario's verdict says nothing
     * about the plan and a bar has to fold a whole run.
     */
    it("draws one sparkline bar per run", () => {
      expect(trendKeyExpr("plan")).toBe("BatchRunId");
      expect(groupKeyExpr("plan")).toBe("ScenarioSetId");
    });
  });

  describe("when grouping by scenario or by target", () => {
    it("draws one sparkline bar per execution", () => {
      expect(trendKeyExpr("scenario")).toBe("ScenarioRunId");
      expect(trendKeyExpr("target")).toBe("ScenarioRunId");
    });
  });

  describe("when grouping by none", () => {
    it("keys each group on one execution", () => {
      expect(groupKeyExpr("none")).toBe("ScenarioRunId");
    });
  });
});
