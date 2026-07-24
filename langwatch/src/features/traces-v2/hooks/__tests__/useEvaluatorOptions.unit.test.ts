// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const useTraceFacetsMock = vi.fn();

vi.mock("../useTraceFacets", () => ({
  useTraceFacets: () => useTraceFacetsMock(),
}));

import { useEvaluatorOptions } from "../useEvaluatorOptions";

beforeEach(() => {
  useTraceFacetsMock.mockReset();
});

describe("useEvaluatorOptions", () => {
  describe("given discover returns the same evaluator more than once", () => {
    it("returns one stable option for that evaluator", () => {
      useTraceFacetsMock.mockReturnValue({
        data: [
          {
            key: "evaluator",
            kind: "categorical",
            topValues: [
              {
                value: "monitor-1",
                label: "Answer quality",
                count: 7,
              },
              {
                value: "monitor-1",
                label: "Answer quality",
                count: 3,
              },
              {
                value: "monitor-2",
                label: "Groundedness",
                count: 2,
              },
            ],
          },
        ],
      });

      const { result } = renderHook(() => useEvaluatorOptions());

      expect(result.current.options).toEqual([
        { value: "monitor-1", label: "Answer quality" },
        { value: "monitor-2", label: "Groundedness" },
      ]);
      expect(result.current.nameByKey).toEqual(
        new Map([
          ["monitor-1", "Answer quality"],
          ["monitor-2", "Groundedness"],
        ]),
      );
    });
  });
});
