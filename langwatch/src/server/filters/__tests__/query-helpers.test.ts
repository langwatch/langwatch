import { describe, expect, it } from "vitest";
import {
  ATTRIBUTE_KEYS,
  buildTraceSummariesConditions,
  buildStoredSpansConditions,
  buildEvaluationRunsConditions,
  buildQueryFilter,
  extractStandardResults,
} from "../clickhouse/query-helpers";
import type { ClickHouseFilterQueryParams } from "../clickhouse/types";

describe("ATTRIBUTE_KEYS", () => {
  it("defines thread_id attribute key", () => {
    expect(ATTRIBUTE_KEYS.thread_id).toBe("Attributes['gen_ai.conversation.id']");
  });

  it("defines user_id attribute key", () => {
    expect(ATTRIBUTE_KEYS.user_id).toBe("Attributes['langwatch.user_id']");
  });

  it("defines customer_id attribute key", () => {
    expect(ATTRIBUTE_KEYS.customer_id).toBe("Attributes['langwatch.customer_id']");
  });
});

describe("buildTraceSummariesConditions", () => {
  const baseParams: ClickHouseFilterQueryParams = {
    tenantId: "test-tenant",
    startDate: 1704067200000,
    endDate: 1704153600000,
  };

  it("returns TenantId condition with parameter placeholder", () => {
    const result = buildTraceSummariesConditions(baseParams);
    expect(result).toContain("TenantId = {tenantId:String}");
  });

  it("returns OccurredAt conditions for partition pruning", () => {
    const result = buildTraceSummariesConditions(baseParams);
    expect(result).toContain(
      "OccurredAt >= fromUnixTimestamp64Milli({startDate:UInt64})"
    );
    expect(result).toContain(
      "OccurredAt <= fromUnixTimestamp64Milli({endDate:UInt64})"
    );
  });

  it("does not filter on CreatedAt (OccurredAt is the user-facing timestamp)", () => {
    const result = buildTraceSummariesConditions(baseParams);
    expect(result).not.toContain("CreatedAt");
  });

  it("filters archived traces via ArchivedAt IS NULL", () => {
    const result = buildTraceSummariesConditions(baseParams);
    expect(result).toContain("ArchivedAt IS NULL");
  });

  it("includes IN-tuple dedup subquery so pre-merge archived rows do not leak", () => {
    const result = buildTraceSummariesConditions(baseParams);
    // Outer keeps ArchivedAt IS NULL; inner dedup must NOT filter ArchivedAt
    // (otherwise max(UpdatedAt) picks a stale version and archived traces
    // reappear).
    expect(result).toContain("(TenantId, TraceId, UpdatedAt) IN (");
    expect(result).toContain("max(UpdatedAt)");
    expect(result).toContain("GROUP BY TenantId, TraceId");
    const innerSubquery = result.substring(
      result.indexOf("(TenantId, TraceId, UpdatedAt) IN ("),
    );
    expect(innerSubquery).not.toContain("ArchivedAt");
  });

  it("joins conditions with AND", () => {
    const result = buildTraceSummariesConditions(baseParams);
    // 5 outer conditions (tenant, archived, 2x occurred-at range, IN-tuple)
    // plus 2 ANDs inside the dedup subquery's WHERE clause → 7 segments.
    expect(result.split(" AND ").length).toBe(7);
  });
});

describe("buildStoredSpansConditions", () => {
  const baseParams: ClickHouseFilterQueryParams = {
    tenantId: "test-tenant",
    startDate: 1704067200000,
    endDate: 1704153600000,
  };

  it("returns TenantId condition with parameter placeholder", () => {
    const result = buildStoredSpansConditions(baseParams);
    expect(result).toContain("TenantId = {tenantId:String}");
  });

  it("uses StartTime instead of CreatedAt", () => {
    const result = buildStoredSpansConditions(baseParams);
    expect(result).toContain(
      "StartTime >= fromUnixTimestamp64Milli({startDate:UInt64})"
    );
    expect(result).toContain(
      "StartTime <= fromUnixTimestamp64Milli({endDate:UInt64})"
    );
  });
});

describe("buildEvaluationRunsConditions", () => {
  const baseParams: ClickHouseFilterQueryParams = {
    tenantId: "test-tenant",
    startDate: 1704067200000,
    endDate: 1704153600000,
  };

  it("returns TenantId condition with parameter placeholder", () => {
    const result = buildEvaluationRunsConditions(baseParams);
    expect(result).toContain("TenantId = {tenantId:String}");
  });

  it("uses ScheduledAt for date filtering", () => {
    const result = buildEvaluationRunsConditions(baseParams);
    expect(result).toContain(
      "ScheduledAt >= fromUnixTimestamp64Milli({startDate:UInt64})"
    );
    expect(result).toContain(
      "ScheduledAt <= fromUnixTimestamp64Milli({endDate:UInt64})"
    );
  });
});

describe("buildQueryFilter", () => {
  it("returns empty string when query is undefined", () => {
    const params: ClickHouseFilterQueryParams = {
      tenantId: "test-tenant",
      startDate: 1704067200000,
      endDate: 1704153600000,
    };
    const result = buildQueryFilter("column", params);
    expect(result).toBe("");
  });

  it("returns empty string when query is empty string", () => {
    const params: ClickHouseFilterQueryParams = {
      tenantId: "test-tenant",
      query: "",
      startDate: 1704067200000,
      endDate: 1704153600000,
    };
    const result = buildQueryFilter("column", params);
    expect(result).toBe("");
  });

  it("returns LIKE clause when query is provided", () => {
    const params: ClickHouseFilterQueryParams = {
      tenantId: "test-tenant",
      query: "search-term",
      startDate: 1704067200000,
      endDate: 1704153600000,
    };
    const result = buildQueryFilter("my_column", params);
    expect(result).toBe(
      "AND lower(my_column) LIKE lower(concat({query:String}, '%'))"
    );
  });
});

describe("extractStandardResults", () => {
  it("extracts field, label, and count from rows", () => {
    const rows = [
      { field: "value1", label: "Label 1", count: "10" },
      { field: "value2", label: "Label 2", count: "20" },
    ];
    const result = extractStandardResults(rows);
    expect(result).toEqual([
      { field: "value1", label: "Label 1", count: 10 },
      { field: "value2", label: "Label 2", count: 20 },
    ]);
  });

  it("parses count as integer", () => {
    const rows = [{ field: "test", label: "Test", count: "42" }];
    const result = extractStandardResults(rows);
    expect(result[0]?.count).toBe(42);
    expect(typeof result[0]?.count).toBe("number");
  });

  it("returns empty array for empty input", () => {
    const result = extractStandardResults([]);
    expect(result).toEqual([]);
  });
});
