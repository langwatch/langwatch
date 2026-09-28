/**
 * @vitest-environment jsdom
 *
 * The Instant Evals gate on the Explorer's `instant_eval` route: a project
 * the flag is off for is told so straight away, and nothing is estimated.
 * @see specs/traces-v2/instant-eval-search.feature
 */
import { useFilterStore } from "@langwatch/trace-browser-kit";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { InstantEvalRoutePayload } from "../../../../../model/instant-eval-route.ts";
import { INSTANT_EVALS_UNRELEASED_COPY, useInstantEvalRoute } from "../use-instant-eval-route.ts";

const mutations = vi.hoisted(() => ({
  estimate: { mutate: vi.fn(), isPending: false },
  start: { mutate: vi.fn(), isPending: false },
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
  sentence: "the user is annoyed",
  question: { instructions: "the user is annoyed" },
  target: "traces",
  otherQuery: "",
  fallbackQuery: '"the user is annoyed"',
  timeRange: { from: 0, to: 1 },
};

beforeEach(() => {
  mutations.estimate.mutate.mockClear();
  toast.mockClear();
  useFilterStore.getState().clearAll();
});

describe("given the Instant Evals flag is off for the project", () => {
  /** @scenario "Instant Evals switched off open the contact-us popover and nothing is searched" */
  it("says Instant Evals are not enabled, estimates nothing and leaves the typed query alone", () => {
    const typed = 'eval:"the user is annoyed"';
    useFilterStore.getState().applyQueryText(typed);
    const { result } = renderHook(() => useInstantEvalRoute({ isInstantEvalAvailable: false }));

    act(() => result.current.onInstantEvalRoute(payload));

    expect(mutations.estimate.mutate).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: INSTANT_EVALS_UNRELEASED_COPY.title,
        action: expect.objectContaining({ label: "Contact us" }),
      }),
    );
    expect(result.current.confirmation).toBeNull();
    expect(useFilterStore.getState().queryText).toBe(typed);
  });
});

describe("given the Instant Evals flag read is still in flight", () => {
  /** @scenario "A flag read still in flight lets the submit reach the estimate" */
  it("lets the payload reach the estimate and says nothing first", () => {
    const { result } = renderHook(() => useInstantEvalRoute({ isInstantEvalAvailable: true }));

    act(() => result.current.onInstantEvalRoute(payload));

    expect(mutations.estimate.mutate).toHaveBeenCalledTimes(1);
    expect(toast).not.toHaveBeenCalled();
  });
});
