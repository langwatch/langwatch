/**
 * @vitest-environment jsdom
 *
 * The Explorer's handler for the `instant_eval` route: the cost rule, the
 * chip, and the refusals that end in the phrase search.
 *
 * Spec: specs/traces-v2/instant-eval-search.feature ("A run starts under the
 * cost rule", "A refusal is a popover, never an error state") and
 * specs/traces-v2/search.feature ("An Instant Eval route starts a run").
 */
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

type MutateOptions<T> = {
  onSuccess?: (result: T) => void;
  onError?: (error: unknown) => void;
};

const mutations = vi.hoisted(() => ({
  estimate: {
    mutate: vi.fn<(input: unknown, options: MutateOptions<unknown>) => void>(),
    isPending: false,
  },
  start: {
    mutate: vi.fn<(input: unknown, options: MutateOptions<unknown>) => void>(),
    isPending: false,
  },
  toast: vi.fn(),
}));

vi.mock("~/utils/api", () => ({
  api: {
    tracesV2: {
      instantEval: {
        estimate: { useMutation: () => mutations.estimate },
        start: { useMutation: () => mutations.start },
      },
    },
  },
}));

vi.mock("~/components/ui/toaster", () => ({
  toaster: { create: mutations.toast },
}));

import { instantEvalRunKey } from "~/server/app-layer/traces/query-language/instantEvalChips";
import { useExplorerStore } from "../../../stores/explorerStore";
import {
  type InstantEvalRoutePayload,
  useInstantEvalRoute,
} from "../useInstantEvalRoute";

const payload: InstantEvalRoutePayload = {
  projectId: "project-1",
  sentence: "annoyed users",
  question: {
    instructions: "the user is annoyed",
    criteria: ["the user complains", "the user is calm"],
  },
  target: "traces",
  otherQuery: "service:api",
  fallbackQuery: 'service:api AND "annoyed users"',
  timeRange: { from: 1_000, to: 2_000 },
};

const estimateOf = (priceUsd: number) => ({
  rows: 12_000,
  isRowsCapped: false,
  avgTokens: 500,
  totalTokens: 6_000_000,
  requests: 12_000,
  costUsd: priceUsd / 1.3,
  priceUsd,
});

function lastCall<T>(mutation: { mutate: ReturnType<typeof vi.fn> }): {
  input: Record<string, unknown>;
  options: MutateOptions<T>;
} {
  const call = mutation.mutate.mock.calls.at(-1);
  if (!call) throw new Error("the mutation was not called");
  return {
    input: call[0] as Record<string, unknown>,
    options: call[1] as MutateOptions<T>,
  };
}

/** A tRPC client error carrying a handled payload, as the client reads it. */
function handledError(code: string, meta: Record<string, unknown> = {}) {
  return {
    message: code,
    data: {
      error: { code, meta, httpStatus: 402, fault: "customer", tips: [] },
    },
  };
}

beforeEach(() => {
  mutations.estimate.mutate.mockClear();
  mutations.start.mutate.mockClear();
  mutations.toast.mockClear();
  useExplorerStore.getState().clearAll();
  useExplorerStore.setState({
    timeRange: { from: 1_000, to: 2_000, label: "Last 7 days", presetId: "7d" },
  });
  useExplorerStore.setState({ activeLensId: "all-traces" });
});

const expectedKey = () =>
  instantEvalRunKey({
    question: "the user is annoyed",
    target: "traces",
    otherQuery: "service:api",
    window: { from: 1_000, to: 2_000, presetId: "7d" },
  });

describe("given the router handed over a question", () => {
  describe("when the estimate is under half a dollar", () => {
    /** @scenario "An estimate under half a dollar starts the run" */
    /** @scenario "An Instant Eval route starts a run" */
    it("starts the run, applies the chip beside the other terms and registers the run", () => {
      const { result } = renderHook(() => useInstantEvalRoute());
      act(() => result.current.onInstantEvalRoute(payload));

      const estimate = lastCall(mutations.estimate);
      expect(estimate.input).toEqual({
        projectId: "project-1",
        target: "traces",
        filter: "service:api",
        window: { from: 1_000, to: 2_000 },
        question: {
          instructions: "the user is annoyed",
          criteria: ["the user complains", "the user is calm"],
        },
      });
      act(() => estimate.options.onSuccess?.(estimateOf(0.2)));
      expect(result.current.confirmation).toBeNull();

      const start = lastCall(mutations.start);
      act(() => start.options.onSuccess?.({ id: "run-1", status: "queued" }));
      expect(useExplorerStore.getState().queryText).toBe(
        'service:api AND eval:"the user is annoyed"',
      );
      expect(useExplorerStore.getState().evalRuns).toEqual({
        [expectedKey()]: "run-1",
      });
    });

    /** @scenario "The start binds the exact window" */
    it("sends the exact window, the other chips and one boolean question", () => {
      const { result } = renderHook(() => useInstantEvalRoute());
      act(() => result.current.onInstantEvalRoute(payload));
      act(() =>
        lastCall(mutations.estimate).options.onSuccess?.(estimateOf(0.1)),
      );
      expect(lastCall(mutations.start).input).toMatchObject({
        window: { from: 1_000, to: 2_000 },
        filter: "service:api",
        question: { instructions: "the user is annoyed" },
      });
    });
  });

  describe("when no model could write the question", () => {
    /** @scenario "A judge question no model could write is judged as typed" */
    it("runs the sentence as the question and says so under the bar", () => {
      const { result } = renderHook(() => useInstantEvalRoute());
      act(() =>
        result.current.onInstantEvalRoute({
          ...payload,
          question: { instructions: "frustrated users" },
          modelTrouble: "model_failed",
        }),
      );
      // No criteria on the wire: the judge reads the words as they stand.
      expect(lastCall(mutations.estimate).input).toMatchObject({
        question: { instructions: "frustrated users" },
      });
      expect(
        (lastCall(mutations.estimate).input.question as Record<string, unknown>)
          .criteria,
      ).toBeUndefined();

      act(() =>
        lastCall(mutations.estimate).options.onSuccess?.(estimateOf(0.1)),
      );
      act(() =>
        lastCall(mutations.start).options.onSuccess?.({
          id: "run-9",
          status: "queued",
        }),
      );
      expect(useExplorerStore.getState().queryText).toBe(
        'service:api AND eval:"frustrated users"',
      );
      expect(useExplorerStore.getState().searchNotice).toEqual({
        projectId: "project-1",
        query: 'service:api AND eval:"frustrated users"',
        interpretedAs: "instant_eval",
        question: "frustrated users",
        modelTrouble: "model_failed",
      });
    });

    it("says nothing under the bar when a model wrote the question", () => {
      const { result } = renderHook(() => useInstantEvalRoute());
      act(() => result.current.onInstantEvalRoute(payload));
      act(() =>
        lastCall(mutations.estimate).options.onSuccess?.(estimateOf(0.1)),
      );
      act(() =>
        lastCall(mutations.start).options.onSuccess?.({
          id: "run-10",
          status: "queued",
        }),
      );
      expect(useExplorerStore.getState().searchNotice).toBeNull();
    });
  });

  describe("when the bar already carries an eval chip", () => {
    /** @scenario "A second question judges the same rows as the first" */
    it("judges the scope without the first chip and keeps both chips in the bar", () => {
      const { result } = renderHook(() => useInstantEvalRoute());
      act(() =>
        result.current.onInstantEvalRoute({
          ...payload,
          question: {
            instructions: "the user asked twice",
            criteria: ["the user repeats", "the user asks once"],
          },
          otherQuery: 'service:api AND eval:"the user is annoyed"',
        }),
      );

      // The scope is the rows the first run judged, not its verdicts: the
      // server holds no run for a chip it is being asked to compile.
      expect(lastCall(mutations.estimate).input).toMatchObject({
        filter: "service:api",
      });
      act(() =>
        lastCall(mutations.estimate).options.onSuccess?.(estimateOf(0.1)),
      );
      expect(lastCall(mutations.start).input).toMatchObject({
        filter: "service:api",
      });
      act(() =>
        lastCall(mutations.start).options.onSuccess?.({
          id: "run-3",
          status: "queued",
        }),
      );

      expect(useExplorerStore.getState().queryText).toBe(
        'service:api AND eval:"the user is annoyed" AND eval:"the user asked twice"',
      );
      expect(useExplorerStore.getState().evalRuns).toEqual({
        [instantEvalRunKey({
          question: "the user asked twice",
          target: "traces",
          otherQuery: "service:api",
          window: { from: 1_000, to: 2_000, presetId: "7d" },
        })]: "run-3",
      });
    });
  });

  describe("when the estimate is half a dollar or more", () => {
    /** @scenario "An estimate of half a dollar or more asks first" */
    it("opens the dialog, and Run starts while the other button searches the words", () => {
      const { result } = renderHook(() => useInstantEvalRoute());
      act(() => result.current.onInstantEvalRoute(payload));
      act(() =>
        lastCall(mutations.estimate).options.onSuccess?.(estimateOf(2.4)),
      );
      expect(result.current.confirmation).toMatchObject({
        question: "the user is annoyed",
        rows: 12_000,
        priceUsd: 2.4,
      });
      expect(mutations.start.mutate).not.toHaveBeenCalled();

      act(() => result.current.confirmRun());
      expect(mutations.start.mutate).toHaveBeenCalledTimes(1);

      act(() => result.current.onInstantEvalRoute(payload));
      act(() =>
        lastCall(mutations.estimate).options.onSuccess?.(estimateOf(2.4)),
      );
      act(() => result.current.searchWordsInstead());
      expect(result.current.confirmation).toBeNull();
      expect(useExplorerStore.getState().queryText).toBe(
        'service:api AND "annoyed users"',
      );
    });
  });

  describe("when the lens judges conversations and the target is traces", () => {
    /** @scenario "A target that differs from the lens default is written on the chip" */
    it("writes the forcing spelling on the chip", () => {
      useExplorerStore.setState({ activeLensId: "conversations" });
      const { result } = renderHook(() => useInstantEvalRoute());
      act(() => result.current.onInstantEvalRoute(payload));
      act(() =>
        lastCall(mutations.estimate).options.onSuccess?.(estimateOf(0.1)),
      );
      act(() =>
        lastCall(mutations.start).options.onSuccess?.({
          id: "run-2",
          status: "queued",
        }),
      );
      expect(useExplorerStore.getState().queryText).toBe(
        'service:api AND eval.trace:"the user is annoyed"',
      );
    });
  });

  describe("when a run is already registered for the scope", () => {
    /** @scenario "A run already registered for the scope is reused" */
    it("applies the chip with no estimate", () => {
      useExplorerStore
        .getState()
        .registerEvalRun({ key: expectedKey(), runId: "run-9" });
      const { result } = renderHook(() => useInstantEvalRoute());
      act(() => result.current.onInstantEvalRoute(payload));
      expect(mutations.estimate.mutate).not.toHaveBeenCalled();
      expect(useExplorerStore.getState().queryText).toBe(
        'service:api AND eval:"the user is annoyed"',
      );
    });
  });
});

describe("given the organization has spent its free budget", () => {
  describe("when the Explorer receives the payload", () => {
    /** @scenario "A spent free budget opens the budget popover and the phrase search runs" */
    it("opens the budget popover, and dismissing it applies the phrase search", () => {
      const { result } = renderHook(() => useInstantEvalRoute());
      act(() => result.current.onInstantEvalRoute(payload));
      act(() =>
        lastCall(mutations.estimate).options.onError?.(
          handledError("instant_eval_free_budget_exhausted", {
            spentUsd: 1.04,
            budgetUsd: 1,
          }),
        ),
      );
      expect(result.current.refusal).toEqual({ kind: "budget" });
      expect(useExplorerStore.getState().queryText).toBe("");
      act(() => result.current.dismissRefusal());
      expect(result.current.refusal).toBeNull();
      expect(useExplorerStore.getState().queryText).toBe(
        'service:api AND "annoyed users"',
      );
    });
  });
});

describe("given the deployment has no classifier", () => {
  describe("when the Explorer receives the payload", () => {
    /** @scenario "A missing classifier opens the model popover and the phrase search runs" */
    it("opens the model popover for either code, and closing it applies the phrase search", () => {
      for (const code of [
        "instant_eval_not_enabled",
        "instant_eval_classifier_unavailable",
      ]) {
        const { result } = renderHook(() => useInstantEvalRoute());
        act(() => result.current.onInstantEvalRoute(payload));
        act(() =>
          lastCall(mutations.estimate).options.onError?.(handledError(code)),
        );
        expect(result.current.refusal).toEqual({ kind: "model" });
        act(() => result.current.dismissRefusal());
        expect(useExplorerStore.getState().queryText).toBe(
          'service:api AND "annoyed users"',
        );
        useExplorerStore.getState().clearAll();
      }
    });
  });
});

describe("given the estimate fails for a reason the registry names", () => {
  describe("when the Explorer receives the payload", () => {
    /** @scenario "Any other refusal falls back to the phrase search" */
    it("shows the registry's copy and applies the phrase search", () => {
      const { result } = renderHook(() => useInstantEvalRoute());
      act(() => result.current.onInstantEvalRoute(payload));
      act(() =>
        lastCall(mutations.estimate).options.onError?.(
          handledError("instant_eval_row_cap_exceeded", {
            requested: 200_000,
            cap: 10_000,
            plan: "free",
            maxCap: 100_000,
          }),
        ),
      );
      expect(result.current.refusal).toBeNull();
      expect(mutations.toast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "That's more rows than one run may judge",
          type: "warning",
        }),
      );
      expect(useExplorerStore.getState().queryText).toBe(
        'service:api AND "annoyed users"',
      );
    });
  });
});
