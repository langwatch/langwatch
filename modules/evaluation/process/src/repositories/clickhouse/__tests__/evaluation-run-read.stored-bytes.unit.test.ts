/** The stored-bytes read is one tenant's built sum on the reader identity (ADR-202 Decided 20). */
import { describe, expect, it } from "vitest";

import { EvaluationRunClickHouseReadRepository } from "../evaluation-run-read.repository.ts";

describe("EvaluationRunClickHouseReadRepository.storedBytesRead()", () => {
  const statement = EvaluationRunClickHouseReadRepository.storedBytesRead({
    tenantId: "project_1",
  });

  it("scopes the read to its one tenant with the tenant setting", () => {
    expect(statement.identity).toBe("reader");
    expect(statement.kind).toBe("tenant");
    expect(statement.tenantId).toBe("project_1");
    expect(statement.settings.SQL_langwatch_tenant_ids).toBe("project_1");
  });

  it("sums `_size_bytes` over evaluation_runs under the meter's thread and time caps", () => {
    expect(statement.sql).toContain("FROM evaluation_runs");
    expect(statement.sql).toContain("sum(_size_bytes)");
    expect(statement.sql).toContain("SETTINGS max_threads = 2, max_execution_time = 45");
  });
});

describe("EvaluationRunClickHouseReadRepository.storedBytesRead before a cutoff", () => {
  const beforeMs = Date.UTC(2026, 7, 1);

  /** @scenario "Evaluation's stored bytes before a cutoff count only rows whose partition time is earlier" */
  it("keeps only rows whose `ScheduledAt` is before the cutoff", () => {
    const statement = EvaluationRunClickHouseReadRepository.storedBytesRead({
      tenantId: "project_1",
      beforeMs: beforeMs,
    });

    expect(statement.sql).toMatch(/ScheduledAt\)? < /);
    expect(Object.values(statement.params)).toContain(beforeMs);
  });

  it("filters on no time without a cutoff", () => {
    expect(
      EvaluationRunClickHouseReadRepository.storedBytesRead({ tenantId: "project_1" }).sql,
    ).not.toMatch(/ScheduledAt\)? < /);
  });
});
