/**
 * `billableEventsTable` is constructed at module load, and `defineTable`
 * (ADR-099) throws `TableDefinitionError` synchronously if a structural rule
 * is violated — an undeclared sort-key column, a partition column that isn't
 * frozen and platform-controlled, a `replacing` version column that isn't a
 * `writtenAt` column. This test pins the declaration's shape so a future
 * change that breaks one of those rules fails here, at the declaration,
 * rather than as an opaque throw the first time some other test happens to
 * import the module.
 */

import { describe, expect, it } from "vitest";

import { billableEventsTable } from "../billableEventsTable";

describe("billableEventsTable", () => {
  it("declares the writable columns in insert order, excluding the materialized hash", () => {
    expect(billableEventsTable.columnNames).toEqual([
      "OrganizationId",
      "TenantId",
      "EventId",
      "EventType",
      "DeduplicationKey",
      "EventTimestamp",
      "UpdatedAt",
    ]);
  });

  it("is a ReplacingMergeTree versioned on UpdatedAt, matching the real table's merge strategy", () => {
    expect(billableEventsTable.merge).toEqual({
      kind: "replacing",
      version: "UpdatedAt",
    });
  });

  it("is tenant-scoped by both TenantId and OrganizationId, matching the schema catalogue", () => {
    expect(billableEventsTable.tenant).toEqual(["TenantId", "OrganizationId"]);
  });

  it("partitions on EventTimestamp, the platform-stamped accept time", () => {
    expect(billableEventsTable.partition).toEqual({
      by: "toYYYYMM(EventTimestamp)",
      column: "EventTimestamp",
    });
  });

  it("describes itself with the ClickHouse type each column round-trips through", () => {
    const description = billableEventsTable.describe();
    expect(description.columnTypes.OrganizationId).toBe("String");
    expect(description.columnTypes.EventType).toBe("LowCardinality(String)");
    expect(description.columnTypes.EventTimestamp).toBe("DateTime64(3)");
    expect(description.columnTypes.UpdatedAt).toBe("DateTime64(3)");
  });
});
