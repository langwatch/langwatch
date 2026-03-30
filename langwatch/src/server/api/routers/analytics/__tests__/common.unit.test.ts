import { describe, expect, it, vi } from "vitest";
import type { QueryDslBoolQuery } from "@elastic/elasticsearch/lib/api/types";
import type { FilterField } from "~/server/filters/types";

const mockLoggerWarn = vi.fn();

vi.mock("~/utils/logger/server", () => ({
  createLogger: () => ({
    warn: mockLoggerWarn,
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Mock the filter registry with one real-looking filter for testing
vi.mock("~/server/filters/registry", () => ({
  availableFilters: {
    "spans.model": {
      name: "Model",
      urlKey: "model",
      query: (values: string[]) => ({ terms: { "spans.model": values } }),
      listMatch: {
        aggregation: () => ({}),
        extract: () => [],
      },
    },
  },
}));

// Dynamic import after mocks are set
const { generateTracesPivotQueryConditions, generateFilterConditions } =
  await import("../common");

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

describe("generateFilterConditions()", () => {
  describe("when filter field is unknown", () => {
    it("returns a match_none condition so the trigger never fires", () => {
      mockLoggerWarn.mockClear();

      const conditions = generateFilterConditions({
        ["service.name" as FilterField]: ["chat"],
      });

      expect(conditions).toEqual([{ match_none: {} }]);
    });

    it("logs a warning with the unknown field name", () => {
      mockLoggerWarn.mockClear();

      generateFilterConditions({
        ["service.name" as FilterField]: ["chat"],
      });

      expect(mockLoggerWarn).toHaveBeenCalledWith(
        { field: "service.name" },
        expect.stringContaining("Unknown filter field"),
      );
    });
  });

  describe("when filter field is known", () => {
    it("returns real query conditions", () => {
      const conditions = generateFilterConditions({
        "spans.model": ["gpt-4"],
      });

      expect(conditions).toHaveLength(1);
      expect(conditions[0]).toEqual({ terms: { "spans.model": ["gpt-4"] } });
    });
  });

  describe("when mixing known and unknown fields", () => {
    it("includes match_none for the unknown field", () => {
      const conditions = generateFilterConditions({
        "spans.model": ["gpt-4"],
        ["service.name" as FilterField]: ["chat"],
      });

      expect(conditions).toHaveLength(2);
      expect(conditions).toContainEqual({ terms: { "spans.model": ["gpt-4"] } });
      expect(conditions).toContainEqual({ match_none: {} });
    });
  });
});
