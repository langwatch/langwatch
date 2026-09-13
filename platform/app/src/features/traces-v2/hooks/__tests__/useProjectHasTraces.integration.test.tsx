/**
 * @vitest-environment jsdom
 *
 * The Trace Explorer's "has this project ever received a trace" read. The
 * project record answers it, but that record is re-read only on focus and
 * on a route change, so the hook polls the small first-trace read while the
 * flag is false and refreshes the record the moment it flips.
 *
 * @see specs/traces-v2/onboarding-empty-state.feature
 */
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { projectRef, firstTraceRef, useQueryMock, invalidateMock } = vi.hoisted(
  () => ({
    projectRef: {
      current: null as { id: string; firstMessage: boolean } | null,
    },
    firstTraceRef: {
      current: undefined as { firstMessage: boolean } | undefined,
    },
    useQueryMock: vi.fn(),
    invalidateMock: vi.fn(() => Promise.resolve()),
  }),
);

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: projectRef.current,
    isLoading: false,
  }),
}));

vi.mock("~/utils/api", () => ({
  api: {
    useUtils: () => ({
      organization: { getAll: { invalidate: invalidateMock } },
    }),
    project: {
      getHasFirstMessage: {
        useQuery: (input: unknown, options: unknown) => {
          useQueryMock(input, options);
          return { data: firstTraceRef.current };
        },
      },
    },
  },
}));

import {
  firstTracePollInterval,
  useProjectHasTraces,
} from "../useProjectHasTraces";

type QueryOptions = {
  enabled: boolean;
  refetchInterval: (query: {
    state: { data: { firstMessage: boolean } | undefined };
  }) => number | false;
};

const lastQueryOptions = (): QueryOptions =>
  useQueryMock.mock.calls.at(-1)![1] as QueryOptions;

describe("useProjectHasTraces", () => {
  beforeEach(() => {
    projectRef.current = { id: "project-1", firstMessage: false };
    firstTraceRef.current = { firstMessage: false };
    useQueryMock.mockClear();
    invalidateMock.mockClear();
  });

  /** @scenario "The Trace Explorer leaves its empty state when the first trace arrives" */
  it("polls the first-trace flag while it is false, then flips and refreshes the project record", () => {
    const { result, rerender } = renderHook(() => useProjectHasTraces());

    // Waiting: the flag is read on its own, on a self-stopping interval.
    expect(result.current.hasAnyTraces).toBe(false);
    expect(useQueryMock).toHaveBeenLastCalledWith(
      { projectId: "project-1" },
      expect.objectContaining({ enabled: true }),
    );
    const { refetchInterval } = lastQueryOptions();
    expect(refetchInterval({ state: { data: { firstMessage: false } } })).toBe(
      5_000,
    );
    expect(refetchInterval({ state: { data: undefined } })).toBe(5_000);
    expect(refetchInterval({ state: { data: { firstMessage: true } } })).toBe(
      false,
    );
    expect(invalidateMock).not.toHaveBeenCalled();

    // The first trace lands: the page leaves its empty state on this read,
    // before the project record has caught up, and that record is refreshed
    // once so every other reader follows.
    firstTraceRef.current = { firstMessage: true };
    rerender();
    expect(result.current.hasAnyTraces).toBe(true);
    expect(invalidateMock).toHaveBeenCalledTimes(1);

    // The record caught up: the poll is off, nothing is refreshed again.
    projectRef.current = { id: "project-1", firstMessage: true };
    rerender();
    expect(result.current.hasAnyTraces).toBe(true);
    expect(lastQueryOptions().enabled).toBe(false);
    expect(invalidateMock).toHaveBeenCalledTimes(1);
  });

  it("never polls for a project that already has traces", () => {
    projectRef.current = { id: "project-1", firstMessage: true };
    firstTraceRef.current = undefined;

    const { result } = renderHook(() => useProjectHasTraces());

    expect(result.current.hasAnyTraces).toBe(true);
    expect(lastQueryOptions().enabled).toBe(false);
    expect(invalidateMock).not.toHaveBeenCalled();
  });

  it("answers nothing while the project context is still loading", () => {
    projectRef.current = null;

    const { result } = renderHook(() => useProjectHasTraces());

    expect(result.current.hasAnyTraces).toBeUndefined();
    expect(lastQueryOptions().enabled).toBe(false);
  });

  it("stops the poll on its own once the flag is true", () => {
    expect(firstTracePollInterval({ firstMessage: false })).toBe(5_000);
    expect(firstTracePollInterval(undefined)).toBe(5_000);
    expect(firstTracePollInterval({ firstMessage: true })).toBe(false);
  });
});
