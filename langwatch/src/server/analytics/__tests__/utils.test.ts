import { describe, expect, it } from "vitest";
import type { FilterParam } from "../../../hooks/useFilterParams";
import type { FilterField } from "../../filters/types";
import { filterOutEmptyFilters } from "../utils";

describe("filterOutEmptyFilters", () => {
  it("should return empty object when filters is undefined", () => {
    const result = filterOutEmptyFilters(undefined);
    expect(result).toEqual({});
  });

  it("should return empty object when filters is empty", () => {
    const result = filterOutEmptyFilters({});
    expect(result).toEqual({});
  });

  it("should filter out empty strings from query params", () => {
    const filters: Partial<Record<FilterField, FilterParam | string>> = {
      "metadata.user_id": "",
      "metadata.customer_id": "customer123",
    };
    const result = filterOutEmptyFilters(filters);
    expect(result).toEqual({
      "metadata.customer_id": "customer123",
    });
  });

  it("should keep non-empty strings from query params", () => {
    const filters: Partial<Record<FilterField, FilterParam | string>> = {
      "metadata.user_id": "user123",
      "metadata.thread_id": "thread456",
    };
    const result = filterOutEmptyFilters(filters);
    expect(result).toEqual({
      "metadata.user_id": "user123",
      "metadata.thread_id": "thread456",
    });
  });

  it("should filter out empty arrays", () => {
    const filters: Partial<Record<FilterField, FilterParam>> = {
      "metadata.user_id": [],
      "metadata.customer_id": ["customer123"],
    };
    const result = filterOutEmptyFilters(filters);
    expect(result).toEqual({
      "metadata.customer_id": ["customer123"],
    });
  });

  it("should filter out empty objects", () => {
    const filters: Partial<Record<FilterField, FilterParam>> = {
      "metadata.user_id": {},
      "metadata.customer_id": { key1: ["value1"] },
    };
    const result = filterOutEmptyFilters(filters);
    expect(result).toEqual({
      "metadata.customer_id": { key1: ["value1"] },
    });
  });

  it("should handle mixed types including strings from query params", () => {
    const filters: Partial<Record<FilterField, FilterParam | string>> = {
      "metadata.user_id": "",
      "metadata.customer_id": [],
      "metadata.thread_id": {},
      "metadata.labels": "label123",
      "metadata.key": { someKey: ["value1"] },
      "topics.topics": ["topic1", "topic2"],
    };
    const result = filterOutEmptyFilters(filters);
    expect(result).toEqual({
      "metadata.labels": "label123",
      "metadata.key": { someKey: ["value1"] },
      "topics.topics": ["topic1", "topic2"],
    });
  });

  it("should keep arrays with elements", () => {
    const filters: Partial<Record<FilterField, FilterParam>> = {
      "metadata.labels": ["label1", "label2", "label3"],
    };
    const result = filterOutEmptyFilters(filters);
    expect(result).toEqual({
      "metadata.labels": ["label1", "label2", "label3"],
    });
  });

  it("should keep objects with keys", () => {
    const filters: Partial<Record<FilterField, FilterParam>> = {
      "metadata.key": { field1: ["value1"], field2: ["value2"] },
    };
    const result = filterOutEmptyFilters(filters);
    expect(result).toEqual({
      "metadata.key": { field1: ["value1"], field2: ["value2"] },
    });
  });

  it("should keep nested objects", () => {
    const filters: Partial<Record<FilterField, FilterParam>> = {
      "metadata.key": {
        level1: {
          level2: ["value"],
        },
      },
    };
    const result = filterOutEmptyFilters(filters);
    expect(result).toEqual({
      "metadata.key": {
        level1: {
          level2: ["value"],
        },
      },
    });
  });
});
