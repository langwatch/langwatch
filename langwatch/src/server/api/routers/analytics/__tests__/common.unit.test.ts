import { describe, expect, it, vi } from "vitest";
import type { QueryDslBoolQuery } from "@elastic/elasticsearch/lib/api/types";

// Mock the filter registry to avoid generated-file dependency chain
vi.mock("~/server/filters/registry", () => ({
  availableFilters: {},
}));

// Dynamic import after mocks are set
const { generateTracesPivotQueryConditions } = await import("../common");

describe("generateTracesPivotQueryConditions()", () => {
  const baseInput = {
    projectId: "proj_123",
    startDate: Date.now() - 86400000,
    endDate: Date.now(),
    filters: {},
  };

  describe("when traceIds is provided", () => {
    it("includes a terms filter for trace_id", () => {
      const traceIds = ["trace-A", "trace-B"];
      const { pivotIndexConditions } = generateTracesPivotQueryConditions({
        ...baseInput,
        traceIds,
      });

      const boolQuery = pivotIndexConditions.bool as QueryDslBoolQuery;
      const mustClauses = boolQuery.must as Array<Record<string, unknown>>;

      const termsFilter = mustClauses.find(
        (clause) =>
          "terms" in clause &&
          (clause as Record<string, unknown>).terms !== undefined,
      );

      expect(termsFilter).toBeDefined();
      expect(termsFilter).toEqual({ terms: { trace_id: traceIds } });
    });
  });

  describe("when traceIds is undefined", () => {
    it("does not include a terms filter for trace_id", () => {
      const { pivotIndexConditions } = generateTracesPivotQueryConditions({
        ...baseInput,
      });

      const boolQuery = pivotIndexConditions.bool as QueryDslBoolQuery;
      const mustClauses = boolQuery.must as Array<Record<string, unknown>>;

      const termsFilter = mustClauses.find(
        (clause) =>
          "terms" in clause &&
          (clause as Record<string, unknown>).terms !== undefined,
      );

      expect(termsFilter).toBeUndefined();
    });
  });

  describe("when traceIds is an empty array", () => {
    it("does not include a terms filter for trace_id", () => {
      const { pivotIndexConditions } = generateTracesPivotQueryConditions({
        ...baseInput,
        traceIds: [],
      });

      const boolQuery = pivotIndexConditions.bool as QueryDslBoolQuery;
      const mustClauses = boolQuery.must as Array<Record<string, unknown>>;

      const termsFilter = mustClauses.find(
        (clause) =>
          "terms" in clause &&
          (clause as Record<string, unknown>).terms !== undefined,
      );

      expect(termsFilter).toBeUndefined();
    });
  });
});
