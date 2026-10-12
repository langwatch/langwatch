/** @vitest-environment jsdom */
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { renderWithDesignSystem } from "../../../testing/index.tsx";
import { ListPage, ListPageError, type ListPageProps, type ListPageState } from "../list-page.tsx";

afterEach(cleanup);

const search = {
  value: "",
  onChange: vi.fn(),
  placeholder: "Search operators",
  ariaLabel: "Search operators",
  testId: "operators-search",
};

function page(state: ListPageState, extra: Partial<ListPageProps> = {}) {
  return (
    <ListPage
      title="Operators"
      state={state}
      toolbar={{ search, filters: <button type="button">Active only</button> }}
      empty={{
        size: "line",
        title: "No operators yet",
        next: [{ kind: "docs", label: "Read about access", href: "https://example.com" }],
      }}
      noResults={{
        description: "No operators match.",
        onClear: vi.fn(),
        next: [{ kind: "docs", label: "How search works", href: "https://example.com" }],
      }}
      error={{
        title: "Could not load operators",
        onRetry: vi.fn(),
        next: [{ kind: "docs", label: "Status page", href: "https://example.com" }],
      }}
      selection={{ label: "1 selected", onClear: vi.fn() }}
      {...extra}
    >
      <div>Alex Morgan</div>
    </ListPage>
  );
}

describe("ListPage", () => {
  it("shows the description once, inside the header", () => {
    renderWithDesignSystem(page("ready", { description: "Who can run operators." }));

    const line = screen.getByText("Who can run operators.");
    expect(screen.getAllByText("Who can run operators.")).toHaveLength(1);
    expect(line.closest("[data-page-header]")).not.toBeNull();
  });

  /** @scenario A list distinguishes loading, empty and failed reads */
  it("replaces rows for loading, emptiness and failure", () => {
    const { rerender } = renderWithDesignSystem(page("loading"));
    expect(screen.getByLabelText("Loading records")).toBeTruthy();
    expect(screen.queryByText("Alex Morgan")).toBeNull();
    rerender(page("empty"));
    expect(screen.getByText("No operators yet")).toBeTruthy();
    expect(screen.queryByText("Alex Morgan")).toBeNull();
    rerender(page("error"));
    expect(screen.getByRole("alert").textContent).toContain("Could not load operators");
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
    expect(screen.queryByText("Alex Morgan")).toBeNull();
  });

  /** @scenario A list distinguishes loading, empty and failed reads */
  it("runs the retry the error carries", async () => {
    const onRetry = vi.fn();
    renderWithDesignSystem(
      page("error", {
        error: {
          title: "Failed",
          onRetry,
          next: [{ kind: "docs", label: "Status page", href: "https://example.com" }],
        },
      }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  /** @scenario Refreshing a list retains records and controlled paging */
  it("retains records while refreshing and delegates page changes", async () => {
    const onPageChange = vi.fn();
    renderWithDesignSystem(
      page("ready", {
        refreshing: true,
        pagination: { page: 2, pageSize: 25, totalCount: 60, onPageChange },
      }),
    );
    expect(screen.getByText("Alex Morgan")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("Refreshing");
    fireEvent.click(screen.getByRole("button", { name: /previous page/i }));
    await waitFor(() => expect(onPageChange).toHaveBeenCalledWith(1));
  });

  /** @scenario The toolbar follows the state */
  it("shows the toolbar, paging and selection only where they make sense", () => {
    const paging = { page: 1, pageSize: 25, totalCount: 60, onPageChange: vi.fn() };
    const { rerender } = renderWithDesignSystem(page("loading"));
    expect(screen.getByRole("button", { name: "Active only" })).toBeTruthy();
    expect(screen.getByRole("searchbox", { name: "Search operators" })).toHaveProperty(
      "disabled",
      true,
    );
    for (const state of ["error", "empty"] as const) {
      rerender(page(state));
      expect(screen.queryByRole("searchbox")).toBeNull();
      expect(screen.queryByRole("button", { name: "Active only" })).toBeNull();
      expect(screen.queryByText("1 selected")).toBeNull();
    }
    rerender(page("no-results", { pagination: paging }));
    expect(screen.getByRole("searchbox")).toHaveProperty("disabled", false);
    expect(screen.getByText("No operators match.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Clear filters" })).toBeTruthy();
    expect(screen.queryByText("Alex Morgan")).toBeNull();
    expect(screen.queryByRole("button", { name: /previous page/i })).toBeNull();
    rerender(page("ready", { pagination: paging }));
    expect(screen.getByRole("searchbox")).toHaveProperty("disabled", false);
    expect(screen.getByText("Alex Morgan")).toBeTruthy();
    expect(screen.getByRole("button", { name: /previous page/i })).toBeTruthy();
  });

  /** @scenario Search is a named, testable control */
  it("names the search box and reports typing", async () => {
    const onChange = vi.fn();
    renderWithDesignSystem(page("ready", { toolbar: { search: { ...search, onChange } } }));
    const box = screen.getByRole("searchbox", { name: "Search operators" });
    expect(box.getAttribute("placeholder")).toBe("Search operators");
    expect(box.getAttribute("data-testid")).toBe("operators-search");
    await userEvent.type(box, "a");
    expect(onChange).toHaveBeenCalledWith("a");
  });

  /** @scenario A failed refresh keeps the rows */
  it("shows an error beside retained rows as an inline notice", () => {
    renderWithDesignSystem(page("ready"));
    expect(screen.getByText("Alex Morgan")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("Could not load operators");
  });

  /** @scenario An appending list loads more instead of paging */
  it("loads more for an append feed and draws no page controls", async () => {
    const onLoadMore = vi.fn();
    renderWithDesignSystem(
      page("ready", {
        error: undefined,
        loadMore: { hasMore: true, loading: false, onLoadMore, shown: 1, total: 40 },
      }),
    );
    expect(screen.getByText("Showing 1 of 40")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /previous page/i })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Load more" }));
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  /** @scenario A detail list keeps its way back as a link */
  it("keeps the back link's href and routes plain clicks in place", async () => {
    const onNavigate = vi.fn();
    renderWithDesignSystem(
      page("ready", { error: undefined, back: { label: "Teams", href: "/teams", onNavigate } }),
    );
    const link = screen.getByRole("link", { name: /Teams/ });
    expect(link.getAttribute("href")).toBe("/teams");
    await userEvent.click(link);
    expect(onNavigate).toHaveBeenCalledWith("/teams");
    onNavigate.mockClear();
    document.addEventListener("click", (event) => event.preventDefault(), { once: true });
    fireEvent.click(link, { metaKey: true });
    expect(onNavigate).not.toHaveBeenCalled();
  });

  /** @scenario Bulk selection appears only over ready rows */
  it("shows the selection bar for ready rows only", () => {
    const { rerender } = renderWithDesignSystem(page("ready", { error: undefined }));
    expect(screen.getByText("1 selected")).toBeTruthy();
    for (const state of ["loading", "error", "empty", "no-results"] as const) {
      rerender(page(state));
      expect(screen.queryByText("1 selected")).toBeNull();
    }
  });

  /** @scenario Pages written before the states keep working */
  it("still renders the loading, error, empty and toolbar nodes of the old shape", () => {
    const view = (props: {
      loading?: boolean;
      empty?: React.ReactNode;
      error?: React.ReactNode;
    }) => (
      <ListPage title="Operators" toolbar={<span>Legacy toolbar</span>} {...props}>
        <div>Alex Morgan</div>
      </ListPage>
    );
    const { rerender } = renderWithDesignSystem(view({ loading: true }));
    expect(screen.getByLabelText("Loading records")).toBeTruthy();
    expect(screen.getByText("Legacy toolbar")).toBeTruthy();
    rerender(view({ empty: "No matching operators" }));
    expect(screen.getByText("No matching operators")).toBeTruthy();
    rerender(view({ error: <ListPageError title="Could not load operators" /> }));
    expect(screen.getByRole("alert").textContent).toContain("Could not load operators");
  });

  /** @scenario An empty list always points to a next step */
  it("draws the configured empty step and no generic fallback", () => {
    renderWithDesignSystem(
      <ListPage
        title="Operators"
        state="empty"
        // @ts-expect-error an empty config without a next step is refused
        empty={{ size: "line", title: "No operators yet" }}
      >
        <div />
      </ListPage>,
    );
    expect(screen.getByText("No operators yet")).toBeTruthy();
    expect(screen.queryByText("Nothing here yet.")).toBeNull();
  });

  /** @scenario An empty list always points to a next step */
  it("refuses error, no-results and empty configs without a non-empty next step", () => {
    const rejected = () => (
      <>
        {/* @ts-expect-error an error config needs a next step */}
        <ListPage title="A" state="error" error={{ title: "Failed" }}>
          <div />
        </ListPage>
        {/* @ts-expect-error a no-results config needs a next step */}
        <ListPage title="A" state="no-results" noResults={{ description: "None" }}>
          <div />
        </ListPage>
        {/* @ts-expect-error a next step cannot be an empty list */}
        <ListPage title="A" state="empty" empty={{ size: "line", title: "None", next: [] }}>
          <div />
        </ListPage>
      </>
    );
    expect(rejected).toBeTypeOf("function");
  });

  /** @scenario An empty list always points to a next step */
  it("draws the next step beside retry and clear, never instead of them", async () => {
    const { rerender } = renderWithDesignSystem(page("error"));
    expect(screen.getByRole("link", { name: "Status page" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
    rerender(page("no-results"));
    expect(screen.getByRole("link", { name: "How search works" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Clear filters" })).toBeTruthy();
  });

  /** @scenario Bulk selection appears only over ready rows */
  it("draws an inline selection bar as the first band of the page, not a floating one", () => {
    renderWithDesignSystem(
      page("ready", {
        error: undefined,
        selection: { placement: "inline", label: "2 selected", onClear: vi.fn() },
      }),
    );
    const bar = screen.getByText("2 selected").closest("[data-placement]");
    expect(bar?.getAttribute("data-placement")).toBe("inline");
    const search = screen.getByRole("searchbox");
    expect(
      bar && search.compareDocumentPosition(bar) & Node.DOCUMENT_POSITION_PRECEDING,
    ).toBeTruthy();
  });
});
