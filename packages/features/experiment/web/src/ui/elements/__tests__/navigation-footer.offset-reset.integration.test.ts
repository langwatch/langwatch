/**
 * Offset-mode lists must return to the first page whenever the result set they are counting into changes.
 * @vitest-environment jsdom
 * @see specs/traces/pagination-controls.feature
 */
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

let mockQuery: Record<string, string> = {};
const mockPush = vi.fn();

vi.mock("@langwatch/ui-host/use-router", () => ({
  useRouter: () => ({
    query: mockQuery,
    pathname: "/[project]/experiments",
    push: mockPush,
    isReady: true,
  }),
}));

const { useMessagesNavigationFooter } = await import("../navigation-footer");

const lastQuery = () => mockPush.mock.lastCall![0].query;

describe("useMessagesNavigationFooter() in offset mode", () => {
  beforeEach(() => {
    mockPush.mockClear();
    mockQuery = {
      project: "my-project",
      pageOffset: "75",
      pageSize: "25",
    };
  });

  describe("given the list is showing a page well past the first", () => {
    describe("when the page size changes", () => {
      it("returns to the first page instead of holding the old offset", () => {
        const { result } = renderHook(() => useMessagesNavigationFooter());

        act(() => {
          result.current.changePageSize(50);
        });

        // 0 is the default, so it is stripped from the URL rather than written.
        expect(lastQuery().pageOffset).toBeUndefined();
        expect(lastQuery().pageSize).toBe("50");
      });
    });

    describe("when the search query changes", () => {
      it("returns to the first page instead of holding the old offset", () => {
        mockQuery = { ...mockQuery, query: "first" };
        const { rerender } = renderHook(() => useMessagesNavigationFooter("offset"));

        mockQuery = { ...mockQuery, query: "second" };
        act(() => {
          rerender();
        });

        expect(mockPush).toHaveBeenCalled();
        expect(lastQuery().pageOffset).toBeUndefined();
      });
    });
  });

  describe("given a cursor list", () => {
    describe("when the page size changes", () => {
      it("keeps the offset out of the URL entirely", () => {
        // The reset above passes 0 unconditionally; in cursor mode the offset
        // must still never reach the URL, since the server rejects a non-zero
        // one and the whole point of the mode is that it is not used.
        mockQuery = { project: "my-project", scrollId: "cursor-token" };
        const { result } = renderHook(() => useMessagesNavigationFooter("cursor"));

        act(() => {
          result.current.changePageSize(50);
        });

        expect(lastQuery().pageOffset).toBeUndefined();
        expect(lastQuery().scrollId).toBeUndefined();
      });
    });
  });
});
