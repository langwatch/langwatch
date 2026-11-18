import { experimentStoredPastRetentionInputSchema } from "@langwatch/experiment-contract";
/** The stored-bytes read is one tenant's built sum on the reader identity (ADR-202 Decided 20). */
import { describe, expect, it } from "vitest";

import {
  storedBytesRead,
  storedPastRetentionCountRead,
} from "../clickhouse.experiment-run.mapper.ts";

describe("storedBytesRead()", () => {
  const statement = storedBytesRead({ projectId: "project_1" });

  it("scopes the read to its one tenant with the tenant setting", () => {
    expect(statement.identity).toBe("reader");
    expect(statement.kind).toBe("tenant");
    expect(statement.tenantId).toBe("project_1");
    expect(statement.settings.SQL_langwatch_tenant_ids).toBe("project_1");
  });

  it("sums each table's `_size_bytes` in a union, then the parts, under the meter's caps", () => {
    for (const table of ["experiment_runs", "experiment_run_items", "dspy_steps"]) {
      expect(statement.sql).toContain(`FROM ${table}`);
    }
    expect(statement.sql.match(/UNION ALL/g)).toHaveLength(2);
    expect(statement.sql).toContain(") AS parts");
    expect(statement.sql).toMatch(/SETTINGS max_threads = 2, max_execution_time = 45$/);
  });
});

describe("storedPastRetentionCountRead()", () => {
  const beforeMs = Date.UTC(2026, 7, 1);
  const statement = storedPastRetentionCountRead({
    projectId: "project_1",
    beforeMs,
    retentionDays: 91,
  });

  /** @scenario "Experiment counts the items a shorter period would remove" */
  it("counts distinct `RunId` before the cutoff, kept forever or longer than the period", () => {
    expect(statement.identity).toBe("reader");
    expect(statement.tenantId).toBe("project_1");
    expect(statement.sql).toContain("FROM experiment_runs");
    expect(statement.sql).toContain("uniqExact(RunId)");
    expect(statement.sql).toMatch(/StartedAt\)? < /);
    expect(statement.sql).toMatch(/_retention_days = /);
    expect(statement.sql).toMatch(/_retention_days > /);
    expect(Object.values(statement.params)).toEqual(expect.arrayContaining([beforeMs, 91]));
  });

  /** @scenario "Experiment refuses a past-retention count without a period" */
  it("refuses a period of 0 days and a count without a cutoff", () => {
    const refusedPaths = (input: object) =>
      experimentStoredPastRetentionInputSchema
        .safeParse(input)
        .error?.issues.map((issue) => issue.path.join("."));

    expect(refusedPaths({ projectId: "project_1", beforeMs, retentionDays: 0 })).toEqual([
      "retentionDays",
    ]);
    expect(refusedPaths({ projectId: "project_1", retentionDays: 91 })).toEqual(["beforeMs"]);
  });
});

describe("storedBytesRead() before a cutoff", () => {
  const beforeMs = Date.UTC(2026, 7, 1);

  /** @scenario "Experiment's stored bytes before a cutoff count only rows whose partition time is earlier" */
  it("keeps runs by StartedAt, items by OccurredAt and DSPy steps by CreatedAt", () => {
    const statement = storedBytesRead({ projectId: "project_1", beforeMs });

    expect(statement.sql).toMatch(/StartedAt\)? < /);
    expect(statement.sql).toMatch(/OccurredAt\)? < /);
    expect(statement.sql).toMatch(/CreatedAt\)? < /);
  });
});
