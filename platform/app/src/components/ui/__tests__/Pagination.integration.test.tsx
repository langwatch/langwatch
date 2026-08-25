/**
 * @vitest-environment jsdom
 *
 * The shared pagination bar: what it says about the page, what it lets the
 * reader jump to, and what it refuses when the data source can only be walked
 * in order.
 *
 * The numbered pager is driven by a state machine that dispatches on a
 * microtask, so every interaction here is awaited rather than fired and
 * asserted in the same tick.
 *
 * @see specs/components/pagination.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

import { Pagination, type PaginationProps } from "../Pagination";

const BASE: PaginationProps = {
  page: 1,
  pageSize: 50,
  totalCount: 500,
  onPageChange: () => undefined,
  onPageSizeChange: () => undefined,
};

function renderPagination(overrides: Partial<PaginationProps> = {}) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <Pagination {...BASE} {...overrides} />
    </ChakraProvider>,
  );
}

afterEach(() => cleanup());

describe("Pagination", () => {
  describe("given more pages than the pager can list", () => {
    /** @scenario "The pager lists page numbers and elides the ones it skips" */
    it("offers the near pages and the last one as numbers, eliding the rest", () => {
      renderPagination({ totalCount: 5000, pageSize: 50 });

      expect(screen.getByTestId("pagination-page-1")).toBeInTheDocument();
      expect(screen.getByTestId("pagination-page-3")).toBeInTheDocument();
      expect(screen.getByTestId("pagination-page-100")).toBeInTheDocument();
      expect(screen.queryByTestId("pagination-page-50")).not.toBeInTheDocument();
      expect(screen.getByText("…")).toBeInTheDocument();
    });

    /** @scenario "Choosing a page number opens that page" */
    it("asks for the chosen page", async () => {
      const onPageChange = vi.fn();
      const user = userEvent.setup();
      renderPagination({ onPageChange });

      await user.click(screen.getByTestId("pagination-page-4"));

      expect(onPageChange).toHaveBeenCalledWith(4);
    });

    describe("when the reader walks with the triggers", () => {
      it("moves one page at a time in either direction", async () => {
        const onPageChange = vi.fn();
        const user = userEvent.setup();
        renderPagination({ page: 3, onPageChange });

        await user.click(screen.getByTestId("pagination-next"));
        expect(onPageChange).toHaveBeenLastCalledWith(4);

        await user.click(screen.getByTestId("pagination-prev"));
        expect(onPageChange).toHaveBeenLastCalledWith(2);
      });
    });

    /** @scenario "The page I am on is marked as the current one" */
    it("announces the page in view as the current one", () => {
      renderPagination({ page: 3 });

      expect(screen.getByTestId("pagination-page-3")).toHaveAttribute(
        "aria-current",
        "page",
      );
      expect(screen.getByTestId("pagination-page-2")).not.toHaveAttribute("aria-current");
    });

    /** @scenario "Back is unavailable on the first page" */
    it("refuses Back while the first page is in view", () => {
      renderPagination({ page: 1 });

      expect(screen.getByTestId("pagination-prev")).toBeDisabled();
      expect(screen.getByTestId("pagination-next")).toBeEnabled();
    });
  });

  describe("given a page of named rows", () => {
    /** @scenario "The bar names the total, the range shown and the page size" */
    it("reads the total, the range and the rows per page", () => {
      renderPagination({ totalCount: 7949, unitLabel: "traces" });

      expect(screen.getByTestId("pagination-indicator")).toHaveTextContent(
        "7,949 traces · showing 1–50 · per page",
      );
      expect(screen.getByTestId("pagination-page-size")).toHaveValue("50");
    });

    /** @scenario "The total is left out when the rows have no name" */
    it("claims no total when the table does not name its rows", () => {
      renderPagination({ totalCount: 120, pageSize: 25 });

      const indicator = screen.getByTestId("pagination-indicator");
      expect(indicator.textContent).toMatch(/^showing 1–25 · per page/);
    });

    describe("when the page holds fewer rows than it could", () => {
      it("ends the range where the rows end", () => {
        renderPagination({
          page: 3,
          totalCount: 7949,
          unitLabel: "traces",
          visibleCount: 12,
        });

        expect(screen.getByTestId("pagination-indicator")).toHaveTextContent(
          "showing 101–112",
        );
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

        expect(screen.getByTestId("pagination-indicator")).toHaveTextContent(
          "showing 51–100",
        );
      });
    });

    describe("when the reader picks a different rows-per-page", () => {
      /** @scenario "Changing rows per page hands the caller the new size" */
      it("hands the new size to the table", () => {
        const onPageSizeChange = vi.fn();
        renderPagination({ page: 3, onPageSizeChange });

        fireEvent.change(screen.getByTestId("pagination-page-size"), {
          target: { value: "100" },
        });

        expect(onPageSizeChange).toHaveBeenCalledWith(100);
      });

      it("offers only the sizes the caller allows", () => {
        renderPagination({ pageSizeOptions: [25, 50, 100] });

        const options = Array.from(
          screen
            .getByTestId("pagination-page-size")
            .querySelectorAll<HTMLOptionElement>("option"),
        ).map((option) => option.value);
        expect(options).toEqual(["25", "50", "100"]);
      });

      it("offers no rows-per-page control when the table cannot change it", () => {
        renderPagination({ onPageSizeChange: undefined });

        expect(screen.queryByTestId("pagination-page-size")).not.toBeInTheDocument();
        expect(screen.getByTestId("pagination-indicator")).not.toHaveTextContent(
          "per page",
        );
      });
    });
  });

  describe("given a data source whose rows can only be reached in order", () => {
    /** @scenario "A page the data source cannot open is shown disabled" */
    it("shows the pages beyond the ones reached but refuses to open them", () => {
      renderPagination({ page: 1, isPageReachable: (page) => page <= 2 });

      expect(screen.getByTestId("pagination-page-2")).toBeEnabled();
      expect(screen.getByTestId("pagination-page-5")).toBeDisabled();
    });

    /** @scenario "Next is unavailable once the data source has no further rows" */
    it("refuses Next when the data source reports nothing after this page", () => {
      renderPagination({ page: 2, canGoNext: false });

      expect(screen.getByTestId("pagination-next")).toBeDisabled();
      expect(screen.getByTestId("pagination-prev")).toBeEnabled();
    });
  });

  describe("given navigation is blocked by work in flight", () => {
    it("refuses every control while the caller holds navigation", () => {
      renderPagination({ page: 3, navDisabled: true });

      expect(screen.getByTestId("pagination-prev")).toBeDisabled();
      expect(screen.getByTestId("pagination-next")).toBeDisabled();
      expect(screen.getByTestId("pagination-page-4")).toBeDisabled();
      expect(screen.getByTestId("pagination-page-size")).toBeDisabled();
    });
  });

  describe("given there is nothing to page through", () => {
    /** @scenario "Nothing renders when there are no rows" */
    it("renders no bar at all once the count is known to be zero", () => {
      renderPagination({ totalCount: 0 });

      expect(screen.queryByTestId("pagination")).not.toBeInTheDocument();
    });
  });

  describe("given the first page is still loading", () => {
    /** @scenario "A placeholder holds the bar's place while the first page loads" */
    it("stands a placeholder in for the description and keeps the bar", () => {
      renderPagination({ totalCount: 0, isLoading: true });

      expect(screen.getByTestId("pagination")).toBeInTheDocument();
      expect(screen.getByTestId("pagination-placeholder")).toBeInTheDocument();
      expect(screen.queryByTestId("pagination-indicator")).not.toBeInTheDocument();
      expect(screen.getByTestId("pagination-prev")).toBeDisabled();
      expect(screen.getByTestId("pagination-next")).toBeDisabled();
    });
  });
});
