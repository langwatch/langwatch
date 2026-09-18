/**
 * @vitest-environment jsdom
 *
 * The Trace Explorer's watch for the project's first trace. The project
 * record answers "has this project ever received a trace", but that record
 * is re-read only on focus and on a route change, so the page polls the
 * small first-trace read while the flag is false and refreshes the record
 * the moment it flips.
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
  useFirstTraceWatch,
} from "../useFirstTraceWatch";

type QueryOptions = {
  enabled: boolean;
  refetchInterval: (query: {
    state: { data: { firstMessage: boolean } | undefined };
  }) => number | false;
};

const lastQueryOptions = (): QueryOptions =>
  useQueryMock.mock.calls.at(-1)![1] as QueryOptions;

describe("useFirstTraceWatch", () => {
  beforeEach(() => {
    projectRef.current = { id: "project-1", firstMessage: false };
    firstTraceRef.current = { firstMessage: false };
    useQueryMock.mockClear();
    invalidateMock.mockClear();
  });

  /** @scenario "The Trace Explorer leaves its empty state when the first trace arrives" */
  it("polls the first-trace flag while it is false, then refreshes the project record once it flips", () => {
    const { rerender } = renderHook(() => useFirstTraceWatch());

    // Waiting: the flag is read on its own, on a self-stopping interval.
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

    // The first trace lands: the shared project record is refreshed once,
    // which is what moves every reader of the flag off the empty state.
    firstTraceRef.current = { firstMessage: true };
    rerender();
    expect(invalidateMock).toHaveBeenCalledTimes(1);

    // The record caught up: the poll is off, nothing is refreshed again.
    projectRef.current = { id: "project-1", firstMessage: true };
    rerender();
    expect(lastQueryOptions().enabled).toBe(false);
    expect(invalidateMock).toHaveBeenCalledTimes(1);
  });

  it("never polls for a project that already has traces", () => {
    projectRef.current = { id: "project-1", firstMessage: true };
    firstTraceRef.current = undefined;

    renderHook(() => useFirstTraceWatch());

    expect(lastQueryOptions().enabled).toBe(false);
    expect(invalidateMock).not.toHaveBeenCalled();
  });

  it("does nothing while the project context is still loading", () => {
    projectRef.current = null;

    renderHook(() => useFirstTraceWatch());

    expect(lastQueryOptions().enabled).toBe(false);
    expect(invalidateMock).not.toHaveBeenCalled();
  });

  it("stops the poll on its own once the flag is true", () => {
    expect(firstTracePollInterval({ firstMessage: false })).toBe(5_000);
    expect(firstTracePollInterval(undefined)).toBe(5_000);
    expect(firstTracePollInterval({ firstMessage: true })).toBe(false);
  });
});
