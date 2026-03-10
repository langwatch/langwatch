/**
 * @vitest-environment jsdom
 *
 * Integration tests for useMessagesNavigationFooter hook.
 *
 * Regression test for issue #2129: pagination controls not working because
 * buildPaginationQuery stripped the `project` dynamic route segment from
 * the query, causing router.push to fail to resolve the [project] pathname.
 *
 * @see specs/traces/pagination-controls.feature
 */
import { renderHook, act } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

const mockPush = vi.fn();

vi.mock("next/router", () => ({
  useRouter: () => ({
    query: { project: "my-project", pageOffset: "0", pageSize: "25" },
    pathname: "/[project]/messages",
    push: mockPush,
    isReady: true,
  }),
}));

const { useMessagesNavigationFooter } = await import("../NavigationFooter");

describe("useMessagesNavigationFooter()", () => {
  describe("given a project-scoped route with default pagination", () => {
    beforeEach(() => {
      mockPush.mockClear();
    });

    describe("when navigating to the next page", () => {
    it("preserves the project slug in the query for dynamic route resolution", () => {
      const { result } = renderHook(() => useMessagesNavigationFooter());

      act(() => {
        result.current.nextPage();
      });

      expect(mockPush).toHaveBeenCalledWith(
        expect.objectContaining({
          query: expect.objectContaining({ project: "my-project" }),
        }),
        undefined,
        expect.any(Object),
      );
    });

    it("sets pageOffset to current offset plus page size", () => {
      const { result } = renderHook(() => useMessagesNavigationFooter());

      act(() => {
        result.current.nextPage();
      });

      expect(mockPush).toHaveBeenCalledWith(
        expect.objectContaining({
          query: expect.objectContaining({ pageOffset: "25" }),
        }),
        undefined,
        expect.any(Object),
      );
    });
  });

  describe("when changing page size", () => {
    it("preserves the project slug in the query", () => {
      const { result } = renderHook(() => useMessagesNavigationFooter());

      act(() => {
        result.current.changePageSize(50);
      });

      expect(mockPush).toHaveBeenCalledWith(
        expect.objectContaining({
          query: expect.objectContaining({ project: "my-project" }),
        }),
        undefined,
        expect.any(Object),
      );
    });

    it("resets pageOffset to 0 and sets new page size", () => {
      const { result } = renderHook(() => useMessagesNavigationFooter());

      act(() => {
        result.current.changePageSize(50);
      });

      const query = mockPush.mock.calls[0]![0].query;
      expect(query.pageOffset).toBeUndefined();
      expect(query.pageSize).toBe("50");
    });
  });
  });
});
