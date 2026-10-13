// @vitest-environment jsdom
/**
 * The trace filters analytics lends the shell, read off the address.
 * Spec: specs/traces/trace-list-page-size-cap.feature
 */

import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  createBrowserUiTraceFilters,
  useUiTraceFiltersReading,
} from "../trace-filters-capability.ts";

const START = "2026-01-01T00:00:00.000Z";
const END = "2026-01-08T00:00:00.000Z";

function appliedFor(search: string) {
  const { result } = renderHook(() =>
    createBrowserUiTraceFilters({
      reading: useUiTraceFiltersReading({ search, projectId: "proj-1" }),
    }).applied(),
  );
  return result.current;
}

describe("the lent trace filters", () => {
  describe("given the address carries a trace filter and a period", () => {
    /** @scenario "The filtered annotations list reads the filters analytics lends" */
    it("answers the filters with the period and no project id", () => {
      const applied = appliedFor(`?topics=billing&startDate=${START}&endDate=${END}&query=refund`);

      expect(applied).toEqual({
        startDate: Date.parse(START),
        endDate: Date.parse(END),
        filters: expect.objectContaining({ "topics.topics": ["billing"] }),
        query: "refund",
      });
      expect(applied).not.toHaveProperty("projectId");
    });

    it("carries a negation the address asks for", () => {
      expect(appliedFor("?topics=billing&negateFilters=true")).toMatchObject({
        negateFilters: true,
      });
    });
  });

  describe("given the address carries a search query and no trace filter", () => {
    /** @scenario "A free-text query alone leaves the annotations list unfiltered" */
    it("answers no filters", () => {
      expect(appliedFor("?query=refund")).toBeUndefined();
    });
  });

  describe("when the component renders again without the address changing", () => {
    it("hands back the very same reading", () => {
      const { result, rerender } = renderHook(() =>
        useUiTraceFiltersReading({ search: "?topics=billing&period=7d", projectId: "proj-1" }),
      );
      const first = result.current;
      rerender();
      expect(result.current).toBe(first);
    });
  });
});
