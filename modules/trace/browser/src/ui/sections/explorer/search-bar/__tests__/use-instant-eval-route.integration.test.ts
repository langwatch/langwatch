import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * @vitest-environment jsdom
 *
 * The refusals on the Explorer's `instant_eval` route: a popover, or the phrase search.
 * @see specs/traces-v2/instant-eval-search.feature ("A refusal is a popover, never an error state")
 */
import { useFilterStore } from "../../../../../behavior/explorer.store.ts";
import type { InstantEvalRoutePayload } from "../../../../../model/instant-eval-route.ts";
import { useInstantEvalRoute } from "../use-instant-eval-route.ts";

type MutateOptions = {
  onSuccess?: (result: unknown) => void;
  onError?: (error: unknown) => void;
};

const mutations = vi.hoisted(() => ({
  estimate: { mutate: vi.fn<(input: unknown, options: MutateOptions) => void>(), isPending: false },
  start: { mutate: vi.fn<(input: unknown, options: MutateOptions) => void>(), isPending: false },
  enable: { mutate: vi.fn<(input: unknown, options: MutateOptions) => void>(), isPending: false },
  invalidateAccess: vi.fn(),
  setAccess: vi.fn(),
}));
vi.mock("../../../../../behavior/trace-api.ts", () => ({
  api: {
    traces: {
      instantEval: {
        estimate: { useMutation: () => mutations.estimate },
        start: { useMutation: () => mutations.start },
        enable: { useMutation: () => mutations.enable },
      },
    },
    useUtils: () => ({
      traces: {
        instantEval: {
          access: { invalidate: mutations.invalidateAccess, setData: mutations.setAccess },
        },
      },
    }),
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

/** The last switch request: its input and callbacks. */
function enableCall(): { input: unknown; options: MutateOptions } {
  const call = mutations.enable.mutate.mock.calls.at(-1);
  if (!call) throw new Error("the switch was not thrown");
  return { input: call[0], options: call[1] };
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
  mutations.enable.mutate.mockClear();
  mutations.invalidateAccess.mockClear();
  mutations.setAccess.mockClear();
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

describe("given Instant Evals are off for an enterprise organization", () => {
  /** @scenario "Instant Evals off for an enterprise organization open the contact-us popover" */
  it("opens the unreleased popover with no estimate, and dismissing it leaves the typed query alone", () => {
    const typed = 'eval:"the user is annoyed"';
    useFilterStore.getState().applyQueryText(typed);
    const { result } = renderHook(() =>
      useInstantEvalRoute({ isInstantEvalAvailable: false, optInOffer: "contact_us" }),
    );

    act(() => result.current.onInstantEvalRoute(payload));

    expect(mutations.estimate.mutate).not.toHaveBeenCalled();
    expect(result.current.refusal).toEqual({ kind: "unreleased" });

    act(() => result.current.dismissRefusal());

    expect(result.current.refusal).toBeNull();
    expect(useFilterStore.getState().queryText).toBe(typed);
  });

  /** @scenario "A member who may not throw the switch is told to ask an admin" */
  it("opens the ask-admin popover for a member who may not switch, and Enable sends nothing", () => {
    const { result } = renderHook(() =>
      useInstantEvalRoute({ isInstantEvalAvailable: false, optInOffer: "ask_admin" }),
    );
    act(() => result.current.onInstantEvalRoute(payload));

    expect(mutations.estimate.mutate).not.toHaveBeenCalled();
    expect(result.current.refusal).toEqual({ kind: "ask_admin" });

    act(() => result.current.enableInstantEvals());
    expect(mutations.enable.mutate).not.toHaveBeenCalled();
  });

  /** @scenario "Instant Evals off for an enterprise organization open the contact-us popover" */
  it("opens the contact-us popover while the offer is still unknown", () => {
    const { result } = renderHook(() => useInstantEvalRoute({ isInstantEvalAvailable: false }));
    act(() => result.current.onInstantEvalRoute(payload));

    expect(result.current.refusal).toEqual({ kind: "unreleased" });

    act(() => result.current.enableInstantEvals());
    expect(mutations.enable.mutate).not.toHaveBeenCalled();
  });
});

describe("given Instant Evals are off for a self-serve organization", () => {
  function renderOptIn() {
    const rendered = renderHook(() =>
      useInstantEvalRoute({ isInstantEvalAvailable: false, optInOffer: "enable" }),
    );
    act(() => rendered.result.current.onInstantEvalRoute(payload));
    return rendered;
  }

  /** @scenario "Instant Evals off for a self-serve organization open the enable popover" */
  it("opens the opt-in popover with no estimate, and dismissing it leaves the typed query alone", () => {
    const queryBefore = useFilterStore.getState().queryText;
    const { result } = renderOptIn();

    expect(mutations.estimate.mutate).not.toHaveBeenCalled();
    expect(result.current.refusal).toEqual({ kind: "opt_in" });

    act(() => result.current.dismissRefusal());

    expect(result.current.refusal).toBeNull();
    expect(useFilterStore.getState().queryText).toBe(queryBefore);
  });

  /** @scenario "Enable switches the organization on and the judgement goes ahead" */
  it("throws the switch for the project, refreshes the access read, closes the popover and estimates the held payload", () => {
    const { result } = renderOptIn();
    act(() => result.current.enableInstantEvals());

    const enable = enableCall();
    expect(enable.input).toEqual({ projectId: "project-1" });
    expect(mutations.estimate.mutate).not.toHaveBeenCalled();

    act(() => enable.options.onSuccess?.({ released: true, offer: "enable" }));

    expect(mutations.setAccess).toHaveBeenCalledWith(
      { projectId: "project-1" },
      { released: true, offer: "enable" },
    );
    expect(mutations.invalidateAccess).toHaveBeenCalledTimes(1);
    expect(result.current.refusal).toBeNull();
    expect(mutations.estimate.mutate).toHaveBeenCalledTimes(1);
    expect(mutations.estimate.mutate.mock.calls.at(-1)?.[0]).toMatchObject({
      projectId: "project-1",
      question: { instructions: "the user is annoyed" },
    });
  });

  /** @scenario "A refused switch is a warning and the popover stays" */
  it("shows the registry's words when the server refuses the switch, and sends no estimate", () => {
    const { result } = renderOptIn();
    act(() => result.current.enableInstantEvals());

    act(() =>
      enableCall().options.onError?.(handledError({ code: "instant_eval_opt_in_not_offered" })),
    );

    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ type: "warning" }));
    expect(mutations.estimate.mutate).not.toHaveBeenCalled();
    expect(result.current.refusal).toEqual({ kind: "opt_in" });
  });

  /** @scenario "Enable switches the organization on and the judgement goes ahead" */
  it("drops a switch answered after the reader closed the popover, but still records the access", () => {
    const { result } = renderOptIn();
    act(() => result.current.enableInstantEvals());
    const enable = enableCall();
    act(() => result.current.dismissRefusal());
    expect(result.current.refusal).toBeNull();

    act(() => enable.options.onSuccess?.({ released: true, offer: "enable" }));

    expect(mutations.setAccess).toHaveBeenCalledTimes(1);
    expect(mutations.estimate.mutate).not.toHaveBeenCalled();
  });

  /** @scenario "Enable switches the organization on and the judgement goes ahead" */
  it("drops a switch answered after a later submit superseded it", () => {
    const { result } = renderOptIn();
    act(() => result.current.enableInstantEvals());
    const enable = enableCall();
    act(() => result.current.abandonPendingRun());

    act(() => enable.options.onSuccess?.({ released: true, offer: "enable" }));

    expect(mutations.estimate.mutate).not.toHaveBeenCalled();
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

/** The last start request's callbacks. */
function startCallbacks(): MutateOptions {
  const call = mutations.start.mutate.mock.calls.at(-1);
  if (!call) throw new Error("no run was started");
  return call[1];
}

describe("given the router answered instant_eval", () => {
  /** @scenario "An Instant Eval route starts a run" */
  it("starts a run when the estimate is under the cost line and applies its eval chip", () => {
    const { result } = renderHook(() => useInstantEvalRoute({ isInstantEvalAvailable: true }));
    act(() => result.current.onInstantEvalRoute(payload));
    act(() => estimateCallbacks().onSuccess?.({ rows: 120, isRowsCapped: false, priceUsd: 0.1 }));

    expect(mutations.start.mutate).toHaveBeenCalledTimes(1);
    expect(result.current.confirmation).toBeNull();

    act(() => startCallbacks().onSuccess?.({ id: "run-1" }));

    const applied = useFilterStore.getState().queryText;
    expect(applied).toContain("service:api");
    expect(applied).toContain('eval:"the user is annoyed"');
  });

  /** @scenario "An Instant Eval route starts a run" */
  it("asks first instead of starting when the estimate is at or over the cost line", () => {
    const { result } = renderHook(() => useInstantEvalRoute({ isInstantEvalAvailable: true }));
    act(() => result.current.onInstantEvalRoute(payload));
    act(() =>
      estimateCallbacks().onSuccess?.({ rows: 90_000, isRowsCapped: false, priceUsd: 0.5 }),
    );

    expect(mutations.start.mutate).not.toHaveBeenCalled();
    expect(result.current.confirmation).toMatchObject({ question: "the user is annoyed" });

    act(() => result.current.confirmRun());

    expect(mutations.start.mutate).toHaveBeenCalledTimes(1);
  });
});
