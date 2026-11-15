/** The stored-bytes read is one tenant's built sum on the reader identity (ADR-202 Decided 20). */
import { describe, expect, it } from "vitest";

import { storedBytesRead } from "../clickhouse.experiment-run.mapper.ts";

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
