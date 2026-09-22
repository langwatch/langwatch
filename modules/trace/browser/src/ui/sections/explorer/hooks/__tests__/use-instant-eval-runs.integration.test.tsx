// @vitest-environment jsdom
/**
 * The map the explorer's reads send: the query's eval chips against the runs
 * the store registered.
 * @see specs/traces-v2/instant-eval-search.feature
 */
import { useFilterStore } from "@langwatch/trace-browser-kit";
import { instantEvalRunKey } from "@langwatch/trace-contract";
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { useInstantEvalRuns } from "../use-instant-eval-runs.ts";

const WINDOW = { from: 1_000, to: 2_000 };
const QUESTION = "the user is annoyed";
const QUERY = `eval:"${QUESTION}"`;

const keyFor = (target: "traces" | "threads") =>
  instantEvalRunKey({ question: QUESTION, target, otherQuery: "", window: WINDOW });

beforeEach(() => {
  useFilterStore.setState({
    debouncedQueryText: QUERY,
    debouncedTimeRange: WINDOW,
    evalRuns: {},
  });
});

describe("given a query with an eval chip", () => {
  describe("when the store holds a run for its key", () => {
    it("sends that run with the read, under the chip's key", () => {
      const key = keyFor("traces");
      useFilterStore.setState({ evalRuns: { [key]: "run-1" } });

      const { result } = renderHook(() => useInstantEvalRuns());

      expect(result.current.evalRuns).toEqual({
        [key]: { question: QUESTION, target: "traces", runId: "run-1" },
      });
      expect(result.current.chips).toHaveLength(1);
    });
  });

  describe("when the store holds no run for it", () => {
    it("sends no map, so the read's input is what it was before Instant Evals", () => {
      const { result } = renderHook(() => useInstantEvalRuns());

      expect(result.current.evalRuns).toBeUndefined();
      expect(result.current.chips[0]?.runId).toBeNull();
    });
  });
});

describe("given a query with no eval chip", () => {
  describe("when the reads ask what to send", () => {
    it("sends no map and finds no chip", () => {
      useFilterStore.setState({ debouncedQueryText: "status:error" });

      const { result } = renderHook(() => useInstantEvalRuns());

      expect(result.current).toEqual({ chips: [], evalRuns: undefined });
    });
  });
});
