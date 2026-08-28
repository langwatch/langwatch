/**
 * @see specs/features/agent-testing/results-atoms.feature
 */

import { describe, expect, it } from "vitest";
import { ScenarioRunStatus } from "~/server/scenarios/scenario-event.enums";
import { categorizeRunStatus } from "~/server/scenarios/scenario-run-category";
import { mapStatus } from "~/server/simulations/simulation-run.mappers";
import {
  buildAtomFilters,
  CODE_TARGET_NAME_EXPR,
  DEDUP_WINDOW_SLACK_MS,
  FAILED_STATUS_VALUES,
  groupKeyExpr,
  PASSED_STATUS_VALUES,
  SCENARIO_KEY_EXPR,
  TARGET_KEY_EXPR,
  TARGET_REF_EXPR,
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
        const sqlSaysPassed = (
          PASSED_STATUS_VALUES as readonly string[]
        ).includes(raw);
        const sqlSaysFailed = (
          FAILED_STATUS_VALUES as readonly string[]
        ).includes(raw);

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

  describe("when the query dedups a run to its latest version", () => {
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

  describe("when the filter names sets", () => {
    /**
     * A run never moves between sets, and ScenarioSetId is part of the dedup
     * key already, so narrowing on it picks the same version either way.
     * Keeping it in the subquery is what stops it grouping over the whole
     * tenant.
     */
    it("puts them where the dedup subquery can use them", () => {
      const filters = buildAtomFilters({
        ...base,
        scenarioSetIds: ["set-1"],
      });

      expect(filters.stableClause).toContain("ScenarioSetId IN");
    });
  });

  describe("when the filter names scenarios", () => {
    /**
     * A scenario is named by the key it folds under, and the name a run from
     * code folds under can arrive with a later version of the run, so the
     * key is read after dedup and never inside it.
     */
    it("reads the scenario key after dedup", () => {
      const filters = buildAtomFilters({
        ...base,
        scenarioIds: ["s1"],
      });

      expect(filters.stableClause).not.toContain("ScenarioId IN");
      expect(filters.volatileClause).toContain(SCENARIO_KEY_EXPR);
      expect(filters.volatileClause).toContain("IN ({atomScenarioIds");
    });
  });

  describe("when the filter names the default set", () => {
    it("expands it to both stored spellings", () => {
      const filters = buildAtomFilters({
        ...base,
        scenarioSetIds: ["default"],
      });

      expect(filters.params.atomSetIds).toEqual(["default", ""]);
    });
  });
});

describe("the grain of a grouping", () => {
  describe("when grouping by run plan", () => {
    /**
     * A plan row covers many scenarios, so one scenario's verdict says nothing
     * about the plan and a bar has to fold a whole run.
     *
     */
    /** @scenario "A run plan bar folds a whole run, a scenario bar folds one execution" */
    it("draws one sparkline bar per run", () => {
      expect(trendKeyExpr("plan")).toBe("BatchRunId");
      expect(groupKeyExpr("plan")).toBe("ScenarioSetId");
    });
  });

  describe("when grouping by scenario or by target", () => {
    /** @scenario "A run plan bar folds a whole run, a scenario bar folds one execution" */
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

describe("the key a target folds under", () => {
  describe("when a run carries both a platform target and reported agents", () => {
    /**
     * The platform runs its own scenarios through the same SDK, so a platform
     * run can report agents too. Reading the reference id first is what keeps
     * such a run on the target a person chose for it.
     */
    it("reads the platform reference id before anything the run reported", () => {
      const refAt = TARGET_KEY_EXPR.indexOf(TARGET_REF_EXPR);
      const nameAt = TARGET_KEY_EXPR.indexOf(CODE_TARGET_NAME_EXPR);

      expect(refAt).toBeGreaterThanOrEqual(0);
      expect(nameAt).toBeGreaterThan(refAt);
    });
  });

  describe("when a run reported no agent", () => {
    it("falls back to the unknown key", () => {
      expect(TARGET_KEY_EXPR).toContain("'unknown'");
    });
  });

  describe("when a run reports an agent beside a simulator and a judge", () => {
    /**
     * A run wires in a user simulator and a judge as well, and neither is what
     * the run tests, so only the agent role may name the target.
     */
    it("keeps only the agents, and joins two of them the way a row reads them", () => {
      expect(CODE_TARGET_NAME_EXPR).toContain("'role') = 'agent'");
      expect(CODE_TARGET_NAME_EXPR).toContain("' vs '");
    });
  });

  describe("when the query filters on target keys", () => {
    /**
     * A run opens with no metadata and gains it when its started event lands,
     * so the key it folds under can differ between versions of one run and may
     * only be read after dedup.
     */
    it("reads the target key after dedup, never inside it", () => {
      const filters = buildAtomFilters({
        projectId: "proj",
        startDate: 1_000_000,
        targetKeys: ["code:acmesupportagent"],
      });

      expect(filters.volatileClause).toContain("atomTargetKeys");
      expect(filters.stableClause).not.toContain("atomTargetKeys");
    });
  });
});
