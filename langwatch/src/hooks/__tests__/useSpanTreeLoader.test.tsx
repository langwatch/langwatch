/**
 * @vitest-environment jsdom
 */

import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { useSpanTreeLoader } from "../useSpanTreeLoader";

// Mock the tRPC api. We only care about the inputs the hook passes to the
// span-read endpoints, so the query stubs return an empty/loading result.
const mockUseQuery = vi.fn();
const mockPaginatedFetch = vi.fn();
const mockDeltaFetch = vi.fn();

vi.mock("../../utils/api", () => ({
  api: {
    tracesV2: {
      spansPaginated: {
        useQuery: (...args: unknown[]) => mockUseQuery(...args),
      },
    },
    useUtils: () => ({
      tracesV2: {
        spansPaginated: { fetch: mockPaginatedFetch },
        spansDelta: { fetch: mockDeltaFetch },
      },
    }),
  },
}));

describe("useSpanTreeLoader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseQuery.mockReturnValue({ data: undefined, error: null });
    mockPaginatedFetch.mockResolvedValue({ spans: [], total: 0 });
    mockDeltaFetch.mockResolvedValue([]);
  });

  describe("when an occurredAtMs hint is provided", () => {
    it("threads it into the initial paginated span read as a partition hint", () => {
      renderHook(() =>
        useSpanTreeLoader({
          projectId: "project-123",
          traceId: "trace-abc",
          occurredAtMs: 1_700_000_000_000,
        }),
      );

      expect(mockUseQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: "project-123",
          traceId: "trace-abc",
          occurredAtMs: 1_700_000_000_000,
        }),
        expect.objectContaining({ enabled: true }),
      );
    });
  });

  describe("when no occurredAtMs hint is provided", () => {
    it("still issues the read (hint is optional, full scan fallback)", () => {
      renderHook(() =>
        useSpanTreeLoader({
          projectId: "project-123",
          traceId: "trace-abc",
        }),
      );

      const [input] = mockUseQuery.mock.calls[0]!;
      expect(input).toMatchObject({
        projectId: "project-123",
        traceId: "trace-abc",
      });
      expect((input as { occurredAtMs?: number }).occurredAtMs).toBeUndefined();
    });
  });
});
