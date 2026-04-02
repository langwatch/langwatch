import { beforeEach, describe, expect, it, vi } from "vitest";
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
    beforeEach(() => {
      mockLoggerWarn.mockClear();
    });

    it("returns a match_none condition so the trigger never fires", () => {
      const { filterConditions } = generateFilterConditions({
        ["service.name" as FilterField]: ["chat"],
      });

      expect(filterConditions).toEqual([{ match_none: {} }]);
    });

    it("sets hasUnknownFilter to true", () => {
      const { hasUnknownFilter } = generateFilterConditions({
        ["service.name" as FilterField]: ["chat"],
      });

      expect(hasUnknownFilter).toBe(true);
    });

    it("logs a warning with the unknown field name", () => {
      generateFilterConditions({
        ["service.name" as FilterField]: ["chat"],
      });

      expect(mockLoggerWarn).toHaveBeenCalledTimes(1);
      expect(mockLoggerWarn).toHaveBeenCalledWith(
        { field: "service.name" },
        expect.stringContaining("Unknown filter field"),
      );
    });
  });

  describe("when filter field is known", () => {
    it("returns real query conditions", () => {
      const { filterConditions } = generateFilterConditions({
        "spans.model": ["gpt-5-mini"],
      });

      expect(filterConditions).toHaveLength(1);
      expect(filterConditions[0]).toEqual({ terms: { "spans.model": ["gpt-5-mini"] } });
    });

    it("sets hasUnknownFilter to false", () => {
      const { hasUnknownFilter } = generateFilterConditions({
        "spans.model": ["gpt-5-mini"],
      });

      expect(hasUnknownFilter).toBe(false);
    });
  });

  describe("when mixing known and unknown fields", () => {
    it("includes match_none for the unknown field", () => {
      const { filterConditions } = generateFilterConditions({
        "spans.model": ["gpt-5-mini"],
        ["service.name" as FilterField]: ["chat"],
      });

      expect(filterConditions).toHaveLength(2);
      expect(filterConditions).toContainEqual({ terms: { "spans.model": ["gpt-5-mini"] } });
      expect(filterConditions).toContainEqual({ match_none: {} });
    });

    it("sets hasUnknownFilter to true", () => {
      const { hasUnknownFilter } = generateFilterConditions({
        "spans.model": ["gpt-5-mini"],
        ["service.name" as FilterField]: ["chat"],
      });

      expect(hasUnknownFilter).toBe(true);
    });
  });
});

describe("generateTracesPivotQueryConditions() with negateFilters", () => {
  const baseInput = {
    projectId: "proj_123",
    startDate: Date.now() - 86400000,
    endDate: Date.now(),
    filters: {},
    negateFilters: true,
  };

  describe("when negateFilters is true and an unknown filter field is present", () => {
    it("adds match_none to must so the query fails closed", () => {
      const { pivotIndexConditions } = generateTracesPivotQueryConditions({
        ...baseInput,
        filters: { ["service.name" as FilterField]: ["chat"] },
      });

      const boolQuery = pivotIndexConditions.bool as QueryDslBoolQuery;
      const mustClauses = boolQuery.must as Array<Record<string, unknown>>;

      expect(mustClauses).toContainEqual({ match_none: {} });
    });

    it("does not include must_not when an unknown filter is negated", () => {
      const { pivotIndexConditions } = generateTracesPivotQueryConditions({
        ...baseInput,
        filters: { ["service.name" as FilterField]: ["chat"] },
      });

      const boolQuery = pivotIndexConditions.bool as QueryDslBoolQuery;

      expect(boolQuery.must_not).toBeUndefined();
    });
  });

  describe("when negateFilters is true and all filter fields are known", () => {
    it("uses must_not for the filter conditions", () => {
      const { pivotIndexConditions } = generateTracesPivotQueryConditions({
        ...baseInput,
        filters: { "spans.model": ["gpt-5-mini"] },
      });

      const boolQuery = pivotIndexConditions.bool as QueryDslBoolQuery;

      expect(boolQuery.must_not).toEqual([
        { terms: { "spans.model": ["gpt-5-mini"] } },
      ]);
    });

    it("does not add match_none to must", () => {
      const { pivotIndexConditions } = generateTracesPivotQueryConditions({
        ...baseInput,
        filters: { "spans.model": ["gpt-5-mini"] },
      });

      const boolQuery = pivotIndexConditions.bool as QueryDslBoolQuery;
      const mustClauses = boolQuery.must as Array<Record<string, unknown>>;

      expect(mustClauses).not.toContainEqual({ match_none: {} });
    });
  });
});
