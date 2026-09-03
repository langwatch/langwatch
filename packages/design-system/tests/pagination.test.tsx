// @vitest-environment jsdom

/**
 * The shared pagination bar: what it says about the page, what it lets the
 * reader jump to, and what it refuses when the data source can only be walked
 * in order.
 *
 * The numbered pager is driven by a state machine that dispatches on a
 * microtask, so every interaction here is awaited rather than fired and
 * asserted in the same tick.
 */
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Pagination, type PaginationProps } from "../src/components/pagination";
import { renderWithDesignSystem } from "../src/testing";

const BASE: PaginationProps = {
  page: 1,
  pageSize: 50,
  totalCount: 500,
  onPageChange: () => undefined,
  onPageSizeChange: () => undefined,
};

function renderPagination(overrides: Partial<PaginationProps> = {}) {
  return renderWithDesignSystem(<Pagination {...BASE} {...overrides} />);
}

const control = (testId: string) => screen.getByTestId(testId) as HTMLButtonElement;
const isDisabled = (testId: string) => control(testId).disabled;
const textOf = (testId: string) => screen.getByTestId(testId).textContent ?? "";

afterEach(() => cleanup());

describe("Pagination", () => {
  describe("given more pages than the pager can list", () => {
    it("offers the near pages and the last one as numbers, eliding the rest", () => {
      renderPagination({ totalCount: 5000, pageSize: 50 });

      expect(screen.getByTestId("pagination-page-1")).toBeTruthy();
      expect(screen.getByTestId("pagination-page-3")).toBeTruthy();
      expect(screen.getByTestId("pagination-page-100")).toBeTruthy();
      expect(screen.queryByTestId("pagination-page-50")).toBeNull();
      expect(screen.getByText("…")).toBeTruthy();
    });

    it("asks for the chosen page", async () => {
      const onPageChange = vi.fn<(page: number) => void>();
      renderPagination({ onPageChange });

      fireEvent.click(screen.getByTestId("pagination-page-4"));

      await waitFor(() => expect(onPageChange).toHaveBeenCalledWith(4));
    });

    describe("when the reader walks with the triggers", () => {
      it("moves one page at a time in either direction", async () => {
        const onPageChange = vi.fn<(page: number) => void>();
        renderPagination({ page: 3, onPageChange });

        fireEvent.click(screen.getByTestId("pagination-next"));
        await waitFor(() => expect(onPageChange).toHaveBeenLastCalledWith(4));

        fireEvent.click(screen.getByTestId("pagination-prev"));
        await waitFor(() => expect(onPageChange).toHaveBeenLastCalledWith(2));
      });
    });

    it("announces the page in view as the current one", () => {
      renderPagination({ page: 3 });

      expect(screen.getByTestId("pagination-page-3").getAttribute("aria-current")).toBe("page");
      expect(screen.getByTestId("pagination-page-2").hasAttribute("aria-current")).toBe(false);
    });

    it("refuses Back while the first page is in view", () => {
      renderPagination({ page: 1 });

      expect(isDisabled("pagination-prev")).toBe(true);
      expect(isDisabled("pagination-next")).toBe(false);
    });
  });

  describe("given a page of named rows", () => {
    it("reads the total, the range and the rows per page", () => {
      renderPagination({ totalCount: 7949, unitLabel: "traces" });

      expect(textOf("pagination-indicator")).toContain("7,949 traces · showing 1–50 · per page");
      expect((screen.getByTestId("pagination-page-size") as HTMLSelectElement).value).toBe("50");
    });

    it("claims no total when the table does not name its rows", () => {
      renderPagination({ totalCount: 120, pageSize: 25 });

      expect(textOf("pagination-indicator")).toMatch(/^showing 1–25 · per page/);
    });

    describe("when the page holds fewer rows than it could", () => {
      it("ends the range where the rows end", () => {
        renderPagination({
          page: 3,
          totalCount: 7949,
          unitLabel: "traces",
          visibleCount: 12,
        });

        expect(textOf("pagination-indicator")).toContain("showing 101–112");
      });
    });

    describe("when the rows have not been counted yet", () => {
      it("assumes a full page rather than a one-row range", () => {
        renderPagination({
          page: 2,
          totalCount: 7949,
          unitLabel: "traces",
          visibleCount: 0,
        });

        expect(textOf("pagination-indicator")).toContain("showing 51–100");
      });
    });

    describe("when the reader picks a different rows-per-page", () => {
      it("hands the new size to the table", () => {
        const onPageSizeChange = vi.fn<(size: number) => void>();
        renderPagination({ page: 3, onPageSizeChange });

        fireEvent.change(screen.getByTestId("pagination-page-size"), {
          target: { value: "100" },
        });

        expect(onPageSizeChange).toHaveBeenCalledWith(100);
      });

      it("offers only the sizes the caller allows", () => {
        renderPagination({ pageSizeOptions: [25, 50, 100] });

        const options = Array.from(
          screen.getByTestId("pagination-page-size").querySelectorAll<HTMLOptionElement>("option"),
        ).map((option) => option.value);
        expect(options).toEqual(["25", "50", "100"]);
      });

      it("offers no rows-per-page control when the table cannot change it", () => {
        renderPagination({ onPageSizeChange: undefined });

        expect(screen.queryByTestId("pagination-page-size")).toBeNull();
        expect(textOf("pagination-indicator")).not.toContain("per page");
      });
    });
  });

  describe("given a data source whose rows can only be reached in order", () => {
    it("shows the pages beyond the ones reached but refuses to open them", () => {
      renderPagination({ page: 1, isPageReachable: (page) => page <= 2 });

      expect(isDisabled("pagination-page-2")).toBe(false);
      expect(isDisabled("pagination-page-5")).toBe(true);
    });

    it("refuses Next when the data source reports nothing after this page", () => {
      renderPagination({ page: 2, canGoNext: false });

      expect(isDisabled("pagination-next")).toBe(true);
      expect(isDisabled("pagination-prev")).toBe(false);
    });
  });

  describe("given navigation is blocked by work in flight", () => {
    it("refuses every control while the caller holds navigation", () => {
      renderPagination({ page: 3, navDisabled: true });

      expect(isDisabled("pagination-prev")).toBe(true);
      expect(isDisabled("pagination-next")).toBe(true);
      expect(isDisabled("pagination-page-4")).toBe(true);
      expect((screen.getByTestId("pagination-page-size") as HTMLSelectElement).disabled).toBe(true);
    });
  });

  describe("given there is nothing to page through", () => {
    it("renders no bar at all once the count is known to be zero", () => {
      renderPagination({ totalCount: 0 });

      expect(screen.queryByTestId("pagination")).toBeNull();
    });
  });

  describe("given the first page is still loading", () => {
    it("stands a placeholder in for the description and keeps the bar", () => {
      renderPagination({ totalCount: 0, isLoading: true });

      expect(screen.getByTestId("pagination")).toBeTruthy();
      expect(screen.getByTestId("pagination-placeholder")).toBeTruthy();
      expect(screen.queryByTestId("pagination-indicator")).toBeNull();
      expect(isDisabled("pagination-prev")).toBe(true);
      expect(isDisabled("pagination-next")).toBe(true);
    });
  });
});
