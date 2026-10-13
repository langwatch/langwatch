// @vitest-environment jsdom
/** Shapes keep what the screens they replace already do: the open-ended pager. */
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Pagination } from "../src/components/layout/pagination.tsx";
import { renderWithDesignSystem } from "../src/testing/index.tsx";

afterEach(cleanup);

describe("an open-ended Pagination", () => {
  /** @scenario "A pager for a source that cannot count steps without fake totals" */
  it("shows Back, Page N and Next, with no total and no numbered jumps", () => {
    renderWithDesignSystem(
      <Pagination page={3} pageSize={25} hasMore visibleCount={25} onPageChange={vi.fn()} />,
    );

    expect(screen.getByTestId("pagination-current").textContent).toBe("Page 3");
    expect(screen.getByTestId("pagination-indicator").textContent).toContain("showing 51–75");
    expect(screen.queryByTestId("pagination-page-1")).toBeNull();
    expect(screen.queryByText(/of \d/)).toBeNull();
  });

  /** @scenario "A pager for a source that cannot count steps without fake totals" */
  it("steps one page each way and waits at both ends", async () => {
    const onPageChange = vi.fn<(page: number) => void>();
    const { rerender } = renderWithDesignSystem(
      <Pagination page={1} pageSize={25} hasMore onPageChange={onPageChange} />,
    );
    const button = (testId: string) => {
      const found = screen.getByTestId(testId);
      if (!(found instanceof HTMLButtonElement)) throw new Error(`${testId} is not a button`);
      return found;
    };

    expect(button("pagination-prev").disabled).toBe(true);
    fireEvent.click(button("pagination-next"));
    await waitFor(() => expect(onPageChange).toHaveBeenLastCalledWith(2));

    rerender(<Pagination page={2} pageSize={25} hasMore={false} onPageChange={onPageChange} />);
    expect(button("pagination-next").disabled).toBe(true);
    fireEvent.click(button("pagination-prev"));
    await waitFor(() => expect(onPageChange).toHaveBeenLastCalledWith(1));
  });

  /** @scenario "A pager for a source that cannot count steps without fake totals" */
  it("shows no range until the rows on the page are given", () => {
    renderWithDesignSystem(
      <Pagination
        page={2}
        pageSize={25}
        hasMore
        onPageChange={vi.fn()}
        onPageSizeChange={vi.fn()}
      />,
    );

    expect(screen.getByTestId("pagination-indicator").textContent).not.toContain("showing");
    expect(screen.getByTestId("pagination-page-size")).toBeTruthy();
  });

  /** @scenario "A pager for a source that cannot count steps without fake totals" */
  it("is unavailable while loading", () => {
    renderWithDesignSystem(
      <Pagination page={1} pageSize={25} hasMore isLoading onPageChange={vi.fn()} />,
    );

    const next = screen.getByTestId("pagination-next");
    expect(next instanceof HTMLButtonElement && next.disabled).toBe(true);
    expect(screen.getByTestId("pagination-placeholder")).toBeTruthy();
  });

  /** @scenario "A pager has nothing to offer when the first page is empty and final" */
  it("draws nothing for an empty first page with nothing more", () => {
    renderWithDesignSystem(
      <Pagination page={1} pageSize={25} hasMore={false} visibleCount={0} onPageChange={vi.fn()} />,
    );

    expect(screen.queryByTestId("pagination")).toBeNull();
  });
});

describe("a known-total Pagination", () => {
  /** @scenario "A pager for a source that can count keeps its numbered pages" */
  it("still offers numbered pages and the total", () => {
    renderWithDesignSystem(
      <Pagination
        page={1}
        pageSize={25}
        totalCount={120}
        unitLabel="runs"
        onPageChange={vi.fn()}
      />,
    );

    expect(screen.getByTestId("pagination-page-5")).toBeTruthy();
    expect(screen.getByTestId("pagination-indicator").textContent).toContain("120 runs");
  });
});
