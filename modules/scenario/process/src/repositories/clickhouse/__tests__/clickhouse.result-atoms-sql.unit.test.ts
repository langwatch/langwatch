/**
 * @see specs/features/agent-testing/results-atoms.feature
 */

import {
  categorizeRunStatus,
  type ResultsFilter,
  type ResultsGroupBy,
  ScenarioRunStatus,
} from "@langwatch/scenario-contract";
import { describe, expect, it } from "vitest";

import {
  FAILED_STATUS_VALUES,
  PASSED_STATUS_VALUES,
  ResultAtomsClickHouseRepository,
} from "../clickhouse.result-atoms.repository.ts";
import { mapStatus } from "../simulation-run.mapper.ts";

const base: ResultsFilter = { projectId: "proj", startDate: 1_000_000 };

/** The atom page's SQL and its bound values, for a filter. */
const pageRead = (filter: ResultsFilter) =>
  ResultAtomsClickHouseRepository.atomPageRead({ filter, limit: 10, after: null });

/** What a read asks of the elected atoms, after the election. */
const afterElection = (sql: string): string => sql.split(") AS atoms WHERE ")[1] ?? "";

/** The SQL with bound value and lambda names blanked: two renderings of one expression compare. */
const unnamed = (sql: string): string => sql.replace(/\{v\d+:/g, "{v:").replace(/__x\d+/g, "__x");

/** The election subquery alone. */
const election = (sql: string): string => {
  const body = sql.split(" IN (SELECT TenantId, ScenarioRunId,")[1] ?? "";
  return body.slice(0, body.indexOf("GROUP BY"));
};

/** The expression a page read selects under an alias. */
const selected = (sql: string, alias: string): string => {
  const end = sql.indexOf(` AS ${alias},`);
  let depth = 0;
  for (let at = end - 1; at > 0; at--) {
    const char = sql[at];
    if (char === ")") depth++;
    if (char === "(") depth--;
    if (depth === 0 && sql.startsWith(", ", at - 1)) return sql.slice(at + 1, end);
  }
  return "";
};

/** The trend key a grouping's built trend read selects. */
const trendKeyExpr = (groupBy: ResultsGroupBy): string | undefined =>
  /\(SELECT .*?, (\w+) AS TrendKey,/.exec(
    ResultAtomsClickHouseRepository.trendRead({ filter: base, groupBy }).sql,
  )?.[1];

/** The group key a grouping's built groups read folds on. */
const groupKeyExpr = (groupBy: ResultsGroupBy): string | undefined =>
  /FROM \(SELECT (.*?) AS GroupKey,/.exec(
    ResultAtomsClickHouseRepository.groupsRead({ filter: base, groupBy }).sql,
  )?.[1];

/**
 * Every raw value the Status column is known to hold, including the legacy
 * spelling that mapStatus folds away.
 */
const RAW_STATUS_VALUES = [...Object.values(ScenarioRunStatus), "FAILURE"] as const;

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
        const isFailureLike =
          category === "failure" || category === "stalled" || category === "cancelled";

        expect(sqlSaysPassed, `${raw} (category "${category}") passed-membership`).toBe(
          category === "success",
        );
        expect(sqlSaysFailed, `${raw} (category "${category}") failed-membership`).toBe(
          isFailureLike,
        );
      }
    });
  });
});

describe("the atom reads' scope", () => {
  describe("when the filter asks for failed or not-scored runs", () => {
    /** @scenario "Server-side pass rates leave out a run whose setup failed" */
    it("keeps a run whose setup failed out of the failures and in the not-scored list", () => {
      const failed = pageRead({ ...base, outcome: "failed" });
      const notScored = pageRead({ ...base, outcome: "not_scored" });

      expect(afterElection(failed.sql)).toContain("AND NOT ((Status = {");
      expect(afterElection(notScored.sql)).toContain("AND (Status = {");
      expect(afterElection(notScored.sql)).not.toContain("NOT ((Status");
      expect(Object.values(failed.params)).toEqual(
        expect.arrayContaining(["langwatch", "hooks", "setup", "status"]),
      );
    });
  });

  describe("when no end date is given", () => {
    /**
     * The period picker pins its end at mount, so a live view sends none. An
     * upper bound there would filter on "started before the page loaded" and a
     * run beginning while someone watches would never appear.
     */
    it("bounds the window only from below", () => {
      const { sql } = ResultAtomsClickHouseRepository.totalsRead(base);

      expect(afterElection(sql)).toContain("StartedAt >=");
      expect(sql).not.toContain("StartedAt <=");
    });
  });

  describe("when an end date is given", () => {
    it("bounds the window at both ends", () => {
      const statement = ResultAtomsClickHouseRepository.totalsRead({ ...base, endDate: 2_000_000 });

      expect(afterElection(statement.sql)).toContain("StartedAt <=");
      expect(Object.values(statement.params)).toContain(2_000_000);
    });
  });

  describe("when the project holds agent test runs", () => {
    /** @scenario "The results lists leave the agent test batches out" */
    it("keeps them out of every atom read", () => {
      for (const { sql, params } of [
        pageRead(base),
        ResultAtomsClickHouseRepository.totalsRead(base),
        ResultAtomsClickHouseRepository.groupsRead({ filter: base, groupBy: "plan" }),
      ]) {
        expect(sql).toContain("NOT (endsWith(ScenarioSetId, {");
        expect(Object.values(params)).toContain("__agent-test");
      }
    });
  });

  describe("when the project holds legacy voice-call runs", () => {
    /** @scenario "The legacy voice-calls set is excluded from run listings" */
    it("excludes the voice-calls set from every atom read, alongside the agent-test set", () => {
      const { sql, params } = pageRead(base);

      expect(sql).toContain("ScenarioSetId != {");
      expect(Object.values(params)).toContain("voice-calls");
    });
  });

  describe("when the filter names a status", () => {
    /**
     * Status differs between versions of one run, so narrowing on it may only
     * happen after the election. Inside it would pick whichever old version
     * still matched.
     */
    it("keeps it out of the election", () => {
      const { sql } = pageRead({ ...base, outcome: "failed" });

      expect(afterElection(sql)).toContain("Status IN (");
      expect(election(sql)).not.toContain("Status");
    });
  });

  describe("when the filter names scenarios", () => {
    /**
     * A scenario is named by the key it folds under, and the name a code run
     * folds under can arrive with a later version of the run, so the key is
     * read after the election and never inside it.
     */
    it("reads the scenario key after the election", () => {
      const statement = pageRead({ ...base, scenarioIds: ["s1"] });

      expect(election(statement.sql)).not.toContain("ScenarioId");
      expect(unnamed(afterElection(statement.sql))).toContain(
        `${unnamed(selected(statement.sql, "ScenarioKey"))} IN ({`,
      );
    });
  });

  describe("when the filter names the default set", () => {
    it("expands it to both stored spellings", () => {
      const { params } = pageRead({ ...base, scenarioSetIds: ["default"] });

      expect(Object.values(params)).toContainEqual(["default", ""]);
    });
  });

  describe("when a cursor is given", () => {
    it("pages backwards through the sort key, breaking ties on the run id", () => {
      const statement = ResultAtomsClickHouseRepository.atomPageRead({
        filter: base,
        limit: 11,
        after: { ts: "1500000", executionId: "run-9" },
      });
      const sortKey = "toUnixTimestamp64Milli(ifNull(StartedAt, CreatedAt))";

      expect(statement.sql).toContain(`(${sortKey} < {`);
      expect(statement.sql).toContain(`ScenarioRunId < {`);
      expect(statement.sql).toContain(`ORDER BY ${sortKey} DESC, ScenarioRunId DESC LIMIT 11`);
      expect(Object.values(statement.params)).toEqual(expect.arrayContaining([1_500_000, "run-9"]));
    });
  });
});

describe("the grain of a grouping", () => {
  describe("when grouping by run plan", () => {
    /**
     * A plan row covers many scenarios, so one scenario's verdict says nothing
     * about the plan and a bar has to fold a whole run.
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
  const targetKey = selected(pageRead(base).sql, "TargetKey");
  const pageParams = Object.values(pageRead(base).params);

  describe("when a run carries the key the platform stamped", () => {
    /**
     * The stamp is what tells one agent's parameter variants apart, so it is
     * read before the bare reference id. A run recorded before the stamp
     * existed carries none and falls through to the reference id, which is
     * the key it always had.
     */
    /** @scenario "A target with parameter overrides is its own target" */
    /** @scenario "An old run with no target key keeps its reference id as key" */
    it("reads the stamped key first, then the reference id", () => {
      const { params } = pageRead(base);
      const stampParam = Object.entries(params).find(([, value]) => value === "targetKey")?.[0];
      const refParams = Object.entries(params)
        .filter(([, value]) => value === "targetReferenceId")
        .map(([name]) => name);
      const refAt = Math.min(
        ...refParams.map((name) => targetKey.indexOf(`{${name}:`)).filter((at) => at >= 0),
      );

      expect(stampParam).toBeDefined();
      expect(targetKey.indexOf(`{${stampParam}:`)).toBeGreaterThanOrEqual(0);
      expect(refAt).toBeGreaterThan(targetKey.indexOf(`{${stampParam}:`));
    });

    it("reads the target's overrides raw, under the reserved namespace", () => {
      const overrides = selected(pageRead(base).sql, "TargetParameters");

      expect(overrides).toMatch(/^JSONExtractRaw\(JSONExtractRaw\(ifNull\(Metadata, /);
      expect(pageParams).toEqual(expect.arrayContaining(["langwatch", "targetParameters"]));
    });
  });

  describe("when a run carries both a platform target and reported agents", () => {
    /**
     * The platform runs its own scenarios through the same SDK, so a platform
     * run can report agents too. Reading the reference id first is what keeps
     * such a run on the target a person chose for it.
     */
    it("reads the platform reference id before anything the run reported", () => {
      const nameAt = targetKey.indexOf("JSONExtractArrayRaw(");
      const refParam = Object.entries(pageRead(base).params).find(
        ([, value]) => value === "targetReferenceId",
      )?.[0];

      expect(nameAt).toBeGreaterThan(0);
      expect(targetKey.indexOf(`{${refParam}:`)).toBeLessThan(nameAt);
    });
  });

  describe("when a run reported no agent", () => {
    it("falls back to the unknown key", () => {
      expect(pageParams).toContain("unknown");
    });
  });

  describe("when a run reports an agent beside a simulator and a judge", () => {
    /**
     * A run wires in a user simulator and a judge as well, and neither is what
     * the run tests, so only the agent role may name the target.
     */
    it("keeps only the agents, and joins two of them the way a row reads them", () => {
      const name = selected(pageRead(base).sql, "TargetName");

      expect(name).toMatch(/^arrayStringConcat\(arrayMap\(/);
      expect(name).toContain("arrayFilter(");
      expect(pageParams).toEqual(expect.arrayContaining(["role", "agent", " vs "]));
    });
  });

  describe("when the query filters on target keys", () => {
    /**
     * A run opens with no metadata and gains it when its started event lands,
     * so the key it folds under can differ between versions of one run and may
     * only be read after the election.
     */
    it("reads the target key after the election, never inside it", () => {
      const { sql } = pageRead({ ...base, targetKeys: ["code:acmesupportagent"] });

      expect(unnamed(afterElection(sql))).toContain(`${unnamed(selected(sql, "TargetKey"))} IN ({`);
      expect(election(sql)).not.toContain("Metadata");
    });
  });
});

describe("the cost of an atom", () => {
  it("reads the run's cost, then the per-trace map, never the trace id list", () => {
    const cost = selected(pageRead(base).sql, "CostUsd");

    expect(cost).toMatch(/^multiIf\(TotalCost IS NOT NULL, toString\(TotalCost\), /);
    expect(cost).toContain("JSONExtractFloat(JSONExtractRaw(TraceMetricsJson, ");
    expect(cost).toContain("JSONExtractKeys(TraceMetricsJson)");
  });
});
