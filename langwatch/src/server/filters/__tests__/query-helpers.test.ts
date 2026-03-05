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
    expect(ATTRIBUTE_KEYS.thread_id).toBe("Attributes['thread.id']");
  });

  it("defines user_id attribute key", () => {
    expect(ATTRIBUTE_KEYS.user_id).toBe("Attributes['user.id']");
  });

  it("defines customer_id attribute key", () => {
    expect(ATTRIBUTE_KEYS.customer_id).toBe("Attributes['customer.id']");
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

  it("returns CreatedAt start condition", () => {
    const result = buildTraceSummariesConditions(baseParams);
    expect(result).toContain(
      "CreatedAt >= fromUnixTimestamp64Milli({startDate:UInt64})"
    );
  });

  it("returns CreatedAt end condition", () => {
    const result = buildTraceSummariesConditions(baseParams);
    expect(result).toContain(
      "CreatedAt <= fromUnixTimestamp64Milli({endDate:UInt64})"
    );
  });

  it("joins conditions with AND", () => {
    const result = buildTraceSummariesConditions(baseParams);
    expect(result.split(" AND ").length).toBe(3);
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
