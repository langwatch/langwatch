import { instantEvalRunKey } from "@langwatch/trace-contract";
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

// @vitest-environment jsdom
/**
 * The map the explorer's reads send: the query's eval chips against the runs
 * the store registered.
 * @see specs/traces-v2/instant-eval-search.feature
 */
import { useFilterStore, useViewStore } from "../../../../behavior/explorer.store.ts";
import { useInstantEvalRunStore } from "../instant-eval-run.store.ts";
import { useHasPendingNegatedEval } from "../use-has-pending-negated-eval.ts";
import { useHasUnjudgeableEval } from "../use-has-unjudgeable-eval.ts";
import { useInstantEvalRuns } from "../use-instant-eval-runs.ts";
import { useMarkRegisteredChipsTyped } from "../use-mark-registered-chips-typed.ts";

const WINDOW = { from: 1_000, to: 2_000 };
const QUESTION = "the user is annoyed";
const QUERY = `eval:"${QUESTION}"`;

const keyFor = (target: "traces" | "threads") =>
  instantEvalRunKey({ question: QUESTION, target, otherQuery: "", window: WINDOW });

/** What Enter records for the chip, in project-1. */
function markSubmitted(): void {
  useInstantEvalRunStore.getState().markTyped({ projectId: "project-1", question: QUESTION });
}

beforeEach(() => {
  useFilterStore.setState({
    debouncedQueryText: QUERY,
    debouncedTimeRange: WINDOW,
    evalRuns: {},
  });
  // Another suite in this worker may leave the conversations lens active, which targets threads.
  useViewStore.setState({ activeLensId: "all-traces" });
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

describe("given a NOT eval chip submitted on this page with no run behind it", () => {
  const NEGATED = `NOT eval:"${QUESTION}"`;

  beforeEach(() => {
    useViewStore.setState({ projectId: "project-1" });
    useInstantEvalRunStore.setState({ typedQuestions: {} });
    useFilterStore.setState({ debouncedQueryText: NEGATED });
    markSubmitted();
  });

  describe("when nothing else changes", () => {
    /** @scenario "A pending chip under NOT is not judged yet" */
    it("is pending, so its rows read as not judged", () => {
      const { result } = renderHook(() => useHasPendingNegatedEval());
      expect(result.current).toBe(true);
    });
  });

  describe("when the time window changes before a run answers it", () => {
    /** @scenario "A pending chip under NOT is not judged yet" */
    it("stays pending rather than falling back to the evaluator-name rows", () => {
      useFilterStore.setState({ debouncedTimeRange: { from: 5_000, to: 9_000 } });
      const { result } = renderHook(() => useHasPendingNegatedEval());
      expect(result.current).toBe(true);
    });
  });

  describe("when the reader moves to another project", () => {
    /** @scenario "A pending chip under NOT is not judged yet" */
    it("does not carry the mark, so a bare chip there keeps its evaluator-name rows", () => {
      useViewStore.setState({ projectId: "project-2" });
      const { result } = renderHook(() => useHasPendingNegatedEval());
      expect(result.current).toBe(false);
    });
  });
});

describe("given a link that restored a run for a bare NOT eval chip", () => {
  const NEGATED = `NOT eval:"${QUESTION}"`;

  beforeEach(() => {
    useViewStore.setState({ projectId: "project-1" });
    useInstantEvalRunStore.setState({ typedQuestions: {} });
    useFilterStore.setState({
      debouncedQueryText: NEGATED,
      evalRuns: { [keyFor("traces")]: "run-1" },
    });
  });

  describe("when the time window changes, so no run answers the new key", () => {
    /** @scenario "A pending chip under NOT is not judged yet" */
    it("stays pending rather than falling back to the evaluator-name rows", () => {
      renderHook(() => useMarkRegisteredChipsTyped());
      useFilterStore.setState({ debouncedTimeRange: { from: 5_000, to: 9_000 } });
      const { result } = renderHook(() => useHasPendingNegatedEval());
      expect(result.current).toBe(true);
    });
  });
});

describe("given a NOT that reaches an eval chip from above an OR", () => {
  beforeEach(() => {
    useViewStore.setState({ projectId: "project-1" });
    useInstantEvalRunStore.setState({ typedQuestions: {} });
  });

  describe("when the chip is bare and was never submitted or run here", () => {
    /** @scenario "A NOT the run of a typed chip cannot answer is refused" */
    it("is not unjudgeable, as it may be an evaluator name", () => {
      useFilterStore.setState({ debouncedQueryText: `NOT eval:"${QUESTION}" OR status:error` });
      const { result } = renderHook(() => useHasUnjudgeableEval());
      expect(result.current).toBe(false);
    });
  });

  describe("when the bare chip was submitted here", () => {
    /** @scenario "A NOT the run of a typed chip cannot answer is refused" */
    it("is unjudgeable", () => {
      markSubmitted();
      useFilterStore.setState({ debouncedQueryText: `NOT eval:"${QUESTION}" OR status:error` });
      const { result } = renderHook(() => useHasUnjudgeableEval());
      expect(result.current).toBe(true);
    });
  });

  describe("when the chip's spelling forces a target", () => {
    /** @scenario "A NOT the run of a typed chip cannot answer is refused" */
    it("is unjudgeable though never submitted here", () => {
      useFilterStore.setState({
        debouncedQueryText: `NOT eval.trace:"${QUESTION}" OR status:error`,
      });
      const { result } = renderHook(() => useHasUnjudgeableEval());
      expect(result.current).toBe(true);
    });
  });
});
