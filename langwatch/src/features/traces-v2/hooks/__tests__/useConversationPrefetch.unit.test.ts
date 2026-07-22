// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useConversationPrefetch } from "../useConversationPrefetch";

const prefetchMock = vi.fn();

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({ project: { id: "p1" } }),
}));

vi.mock("~/utils/api", () => ({
  api: {
    useContext: () => ({
      tracesV2: { header: { prefetch: prefetchMock } },
    }),
  },
}));

vi.mock("../useConversationContext", () => ({
  useConversationContext: () => ({
    turns: [
      { traceId: "trace-0", timestamp: 1_700_000_000_000 },
      { traceId: "trace-1", timestamp: 1_700_000_001_000 },
      { traceId: "trace-2", timestamp: 1_700_000_002_000 },
      { traceId: "trace-3", timestamp: 1_700_000_003_000 },
    ],
  }),
}));

describe("useConversationPrefetch", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    prefetchMock.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("given sibling turns in the same conversation", () => {
    describe("when prefetching the immediate next/previous turn", () => {
      it("prefetches with full IO resolution so opening it is instant", () => {
        renderHook(() => useConversationPrefetch("conv-1", "trace-1"));

        vi.advanceTimersByTime(600);

        expect(prefetchMock).toHaveBeenCalledWith({
          projectId: "p1",
          traceId: "trace-0",
          occurredAtMs: 1_700_000_000_000,
          full: true,
        });
        expect(prefetchMock).toHaveBeenCalledWith({
          projectId: "p1",
          traceId: "trace-2",
          occurredAtMs: 1_700_000_002_000,
          full: true,
        });
      });
    });

    describe("when prefetching a farther turn", () => {
      it("prefetches without the extra spans read full IO resolution costs", () => {
        renderHook(() => useConversationPrefetch("conv-1", "trace-1"));

        vi.advanceTimersByTime(600);

        expect(prefetchMock).toHaveBeenCalledWith({
          projectId: "p1",
          traceId: "trace-3",
          occurredAtMs: 1_700_000_003_000,
          full: false,
        });
      });
    });
  });
});
