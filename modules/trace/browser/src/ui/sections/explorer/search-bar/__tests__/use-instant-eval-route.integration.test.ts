/**
 * @vitest-environment jsdom
 *
 * The refusals on the Explorer's `instant_eval` route: a popover, or the phrase search.
 * @see specs/traces-v2/instant-eval-search.feature ("A refusal is a popover, never an error state")
 */
import { useFilterStore } from "@langwatch/trace-browser-kit";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { InstantEvalRoutePayload } from "../../../../../model/instant-eval-route.ts";
import { useInstantEvalRoute } from "../use-instant-eval-route.ts";

type MutateOptions = {
  onSuccess?: (result: unknown) => void;
  onError?: (error: unknown) => void;
};

const mutations = vi.hoisted(() => ({
  estimate: { mutate: vi.fn<(input: unknown, options: MutateOptions) => void>(), isPending: false },
  start: { mutate: vi.fn<(input: unknown, options: MutateOptions) => void>(), isPending: false },
}));
vi.mock("../../../../../behavior/trace-api.ts", () => ({
  api: {
    traces: {
      instantEval: {
        estimate: { useMutation: () => mutations.estimate },
        start: { useMutation: () => mutations.start },
      },
    },
  },
}));

const toast = vi.hoisted(() => vi.fn());
vi.mock("@langwatch/design-system/toaster", () => ({ toaster: { create: toast } }));

const payload: InstantEvalRoutePayload = {
  projectId: "project-1",
  sentence: "annoyed users",
  question: { instructions: "the user is annoyed" },
  target: "traces",
  otherQuery: "service:api",
  fallbackQuery: 'service:api AND "annoyed users"',
  timeRange: { from: 1_000, to: 2_000 },
};

/** The last estimate request's callbacks. */
function estimateCallbacks(): MutateOptions {
  const call = mutations.estimate.mutate.mock.calls.at(-1);
  if (!call) throw new Error("the estimate was not requested");
  return call[1];
}

/** A tRPC client error carrying a handled payload, as the client reads it. */
function handledError({ code, meta = {} }: { code: string; meta?: Record<string, unknown> }) {
  return {
    message: code,
    data: { error: { code, meta, httpStatus: 402, fault: "customer", tips: [] } },
  };
}

beforeEach(() => {
  mutations.estimate.mutate.mockClear();
  mutations.start.mutate.mockClear();
  toast.mockClear();
  useFilterStore.getState().clearAll();
});

describe("given the organization has spent its free budget", () => {
  /** @scenario "A spent free budget opens the budget popover and the phrase search runs" */
  it("opens the budget popover, and dismissing it applies the phrase search", () => {
    const { result } = renderHook(() => useInstantEvalRoute({ isInstantEvalAvailable: true }));
    act(() => result.current.onInstantEvalRoute(payload));
    act(() =>
      estimateCallbacks().onError?.(
        handledError({
          code: "instant_eval_free_budget_exhausted",
          meta: { spentUsd: 1.04, budgetUsd: 1 },
        }),
      ),
    );

    expect(result.current.refusal).toEqual({ kind: "budget" });
    expect(useFilterStore.getState().queryText).toBe("");

    act(() => result.current.dismissRefusal());

    expect(result.current.refusal).toBeNull();
    expect(useFilterStore.getState().queryText).toBe(payload.fallbackQuery);
  });
});

describe("given the deployment has no classifier", () => {
  /** @scenario "A missing classifier opens the model popover and the phrase search runs" */
  it.each([
    "instant_eval_classifier_unavailable",
    "instant_eval_classifier_not_configured",
    "instant_eval_not_enabled",
  ])("opens the model popover, and closing it applies the phrase search (%s)", (code) => {
    const { result } = renderHook(() => useInstantEvalRoute({ isInstantEvalAvailable: true }));
    act(() => result.current.onInstantEvalRoute(payload));
    act(() => estimateCallbacks().onError?.(handledError({ code })));

    expect(result.current.refusal).toEqual({ kind: "model" });

    act(() => result.current.dismissRefusal());

    expect(useFilterStore.getState().queryText).toBe(payload.fallbackQuery);
  });
});

describe("given the estimate fails for a reason the registry names", () => {
  /** @scenario "Any other refusal falls back to the phrase search" */
  it("shows the registry's copy and applies the phrase search", () => {
    const { result } = renderHook(() => useInstantEvalRoute({ isInstantEvalAvailable: true }));
    act(() => result.current.onInstantEvalRoute(payload));
    act(() =>
      estimateCallbacks().onError?.(
        handledError({
          code: "instant_eval_row_cap_exceeded",
          meta: { requested: 200_000, cap: 10_000, plan: "free", maxCap: 100_000 },
        }),
      ),
    );

    expect(result.current.refusal).toBeNull();
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "That's more rows than one run may judge",
        type: "warning",
      }),
    );
    expect(useFilterStore.getState().queryText).toBe(payload.fallbackQuery);
  });
});

describe("given the Instant Evals flag is off for the project", () => {
  /** @scenario "Instant Evals switched off open the contact-us popover and nothing is searched" */
  it("opens the unreleased popover with no estimate, and dismissing it leaves the typed query alone", () => {
    const typed = 'eval:"the user is annoyed"';
    useFilterStore.getState().applyQueryText(typed);
    const { result } = renderHook(() => useInstantEvalRoute({ isInstantEvalAvailable: false }));

    act(() => result.current.onInstantEvalRoute(payload));

    expect(mutations.estimate.mutate).not.toHaveBeenCalled();
    expect(result.current.refusal).toEqual({ kind: "unreleased" });

    act(() => result.current.dismissRefusal());

    expect(result.current.refusal).toBeNull();
    expect(useFilterStore.getState().queryText).toBe(typed);
  });
});

describe("given the Instant Evals flag read is still in flight", () => {
  /** @scenario "A flag read still in flight lets the submit reach the estimate" */
  it("lets the payload reach the estimate, opens nothing first, and a not_enabled refusal is the model popover", () => {
    const { result } = renderHook(() => useInstantEvalRoute({ isInstantEvalAvailable: true }));

    act(() => result.current.onInstantEvalRoute(payload));

    expect(mutations.estimate.mutate).toHaveBeenCalledTimes(1);
    expect(result.current.refusal).toBeNull();

    act(() => estimateCallbacks().onError?.(handledError({ code: "instant_eval_not_enabled" })));

    expect(result.current.refusal).toEqual({ kind: "model" });
  });
});
