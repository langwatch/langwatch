/**
 * @vitest-environment jsdom
 *
 * Regression test for issue #4077 — Bug 1:
 * prevPage() in cursor-based pagination mode always jumps to page 1
 * instead of navigating to the previous page.
 */
import { renderHook, act } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

let mockQuery: Record<string, string | undefined> = {};
const mockPush = vi.fn().mockImplementation(({ query }) => {
  // Simulate router updating query after push (shallow navigation)
  mockQuery = { ...mockQuery, ...query };
  // Remove keys explicitly set to undefined/null
  for (const [k, v] of Object.entries(mockQuery)) {
    if (v === undefined || v === null) delete mockQuery[k];
  }
});

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({
    query: mockQuery,
    pathname: "/[project]/messages",
    push: mockPush,
    isReady: true,
  }),
}));

const { useMessagesNavigationFooter } = await import("../NavigationFooter");

// A valid base64-encoded cursor that decodes to a ClickHouse scroll cursor
function makeCursor(
  lastTimestamp: number,
  lastTraceId: string,
  pageSize = 25,
  sortDirection: "asc" | "desc" = "desc",
): string {
  return btoa(
    JSON.stringify({ lastTimestamp, lastTraceId, pageSize, sortDirection }),
  );
}

describe("useMessagesNavigationFooter()", () => {
  describe("given cursor-based pagination after navigating forward", () => {
    beforeEach(() => {
      mockQuery = { project: "my-project" };
      mockPush.mockClear();
    });

    describe("when navigating forward via cursor then clicking prevPage", () => {
      it("navigates to the previous page instead of jumping to page 1", () => {
        const { result, rerender } = renderHook(() =>
          useMessagesNavigationFooter(),
        );

        const cursor1 = makeCursor(1700000000000, "trace-page2");
        const cursor2 = makeCursor(1699999000000, "trace-page3");

        // Navigate forward: page 1 → page 2 (cursor mode activates)
        act(() => {
          result.current.nextPage(cursor1);
        });
        rerender();

        // Navigate forward: page 2 → page 3
        act(() => {
          result.current.nextPage(cursor2);
        });
        rerender();

        expect(result.current.cursorPageNumber).toBe(3);

        mockPush.mockClear();

        // Navigate backward: page 3 → page 2
        act(() => {
          result.current.prevPage();
        });

        expect(result.current.cursorPageNumber).toBe(2);

        // Verify prevPage navigated to the correct previous cursor (cursor1)
        expect(mockPush).toHaveBeenCalledWith(
          expect.objectContaining({
            query: expect.objectContaining({ scrollId: cursor1 }),
          }),
          undefined,
          expect.any(Object),
        );
      });
    });

    describe("when navigating forward one page then clicking prevPage", () => {
      it("returns to page 1 correctly since there is no earlier cursor", () => {
        const { result, rerender } = renderHook(() =>
          useMessagesNavigationFooter(),
        );

        const cursor1 = makeCursor(1700000000000, "trace-page2");

        // Navigate forward: page 1 → page 2
        act(() => {
          result.current.nextPage(cursor1);
        });
        rerender();

        expect(result.current.cursorPageNumber).toBe(2);

        mockPush.mockClear();

        // Navigate backward: page 2 → page 1
        act(() => {
          result.current.prevPage();
        });

        // Going back to page 1 is correct when we're on page 2
        // The push should clear the scrollId and go to offset 0
        expect(result.current.cursorPageNumber).toBe(1);
        expect(mockPush).toHaveBeenCalledWith(
          expect.objectContaining({
            query: expect.objectContaining({ project: "my-project" }),
          }),
          undefined,
          expect.any(Object),
        );
        // Should NOT have a scrollId in the query (back to offset mode)
        const pushQuery = mockPush.mock.calls[0]![0].query;
        expect(pushQuery.scrollId).toBeUndefined();
      });
    });
  });
});
