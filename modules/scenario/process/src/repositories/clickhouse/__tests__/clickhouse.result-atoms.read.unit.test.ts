/**
 * The typed atom reads are one tenant's built reads on the reader identity (ADR-202).
 * @see specs/features/agent-testing/results-atoms.feature
 */
import type { ResultsFilter } from "@langwatch/scenario-contract";
import { describe, expect, it } from "vitest";

import {
  DEDUP_WINDOW_SLACK_MS,
  ResultAtomsClickHouseRepository,
} from "../clickhouse.result-atoms.repository.ts";
import { RunConfigurationsClickHouseRepository } from "../clickhouse.run-configurations.repository.ts";

const startDate = Date.UTC(2026, 0, 15);
const endDate = Date.UTC(2026, 1, 15);
const filter: ResultsFilter = { projectId: "project_1", startDate, endDate };

const statements = {
  runOrdinals: ResultAtomsClickHouseRepository.runOrdinalsRead(filter),
  codeScenarios: ResultAtomsClickHouseRepository.codeScenariosRead(filter),
  runTargets: ResultAtomsClickHouseRepository.runTargetsRead(filter),
  trend: ResultAtomsClickHouseRepository.trendRead({ filter, groupBy: "scenario" }),
  series: ResultAtomsClickHouseRepository.seriesRead({ filter, bucketSeconds: 3600 }),
  configurations: RunConfigurationsClickHouseRepository.configurationsRead({ filter }),
};

describe("the typed atom reads", () => {
  describe.each(Object.entries(statements))("given the %s read", (_name, statement) => {
    it("scopes the read to its one tenant with the tenant setting", () => {
      expect(statement.identity).toBe("reader");
      expect(statement.kind).toBe("tenant");
      expect(statement.tenantId).toBe("project_1");
      expect(statement.settings.SQL_langwatch_tenant_ids).toBe("project_1");
    });

    it("elects each run's latest version over the widened window, the exact one after", () => {
      const [scan, election] = statement.sql.split(" IN (SELECT TenantId, ScenarioRunId,");
      const values = Object.values(statement.params);

      expect(statement.sql).toContain("FROM simulation_runs");
      expect(election).toContain("max(UpdatedAt) FROM simulation_runs WHERE TenantId = {");
      expect(election).toContain("StartedAt >=");
      expect(scan).toContain("ArchivedAt IS NULL");
      expect(values).toEqual(
        expect.arrayContaining([
          startDate,
          endDate,
          startDate - DEDUP_WINDOW_SLACK_MS,
          endDate + DEDUP_WINDOW_SLACK_MS,
        ]),
      );
    });

    it("keeps agent test and legacy voice-call runs out", () => {
      expect(statement.sql).toContain("NOT (endsWith(ScenarioSetId, {");
      expect(Object.values(statement.params)).toEqual(
        expect.arrayContaining(["__agent-test", "voice-calls"]),
      );
    });
  });

  describe("when the filter names a status", () => {
    /**
     * Status differs between versions of one run, so narrowing on it may only happen after the
     * election: inside it would pick whichever old version still matched.
     */
    it("keeps it out of the election", () => {
      const statement = ResultAtomsClickHouseRepository.runOrdinalsRead({
        ...filter,
        outcome: "failed",
      });
      const election = statement.sql.split(" IN (SELECT TenantId, ScenarioRunId,")[1] ?? "";
      const electionBody = election.slice(0, election.indexOf("GROUP BY"));

      expect(statement.sql).toContain("Status IN (");
      expect(electionBody).not.toContain("Status");
    });
  });

  describe("when no end date is given", () => {
    it("bounds the window only from below", () => {
      const statement = ResultAtomsClickHouseRepository.seriesRead({
        filter: { projectId: "project_1", startDate },
        bucketSeconds: 60,
      });

      expect(statement.sql).toContain("StartedAt >=");
      expect(statement.sql).not.toContain("StartedAt <=");
    });
  });
});
