/** @vitest-environment jsdom */
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { renderWithDesignSystem } from "../../../testing/index.tsx";
import { ListPage, ListPageError } from "../list-page.tsx";

afterEach(cleanup);
describe("ListPage", () => {
  /** @scenario A list distinguishes loading, empty and failed reads */
  it("replaces rows for initial loading, emptiness and failure", () => {
    const view = (props: {
      loading?: boolean;
      empty?: React.ReactNode;
      error?: React.ReactNode;
    }) => (
      <>
        <ListPage title="Operators" {...props}>
          <div>Alex Morgan</div>
        </ListPage>
      </>
    );
    const { rerender } = renderWithDesignSystem(view({ loading: true }));
    expect(screen.getByLabelText("Loading records")).toBeTruthy();
    expect(screen.queryByText("Alex Morgan")).toBeNull();
    rerender(view({ empty: "No matching operators" }));
    expect(screen.getByText("No matching operators")).toBeTruthy();
    expect(screen.queryByText("Alex Morgan")).toBeNull();
    rerender(view({ error: <ListPageError title="Could not load operators" /> }));
    expect(screen.getByRole("alert").textContent).toContain("Could not load operators");
    expect(screen.queryByText("Alex Morgan")).toBeNull();
  });
  /** @scenario Refreshing a list retains records and controlled paging */
  it("retains records while refreshing and delegates page changes", async () => {
    const onPageChange = vi.fn();
    renderWithDesignSystem(
      <>
        <ListPage
          title="Operators"
          refreshing
          pagination={{ page: 2, pageSize: 25, totalCount: 60, onPageChange }}
        >
          <div>Alex Morgan</div>
        </ListPage>
      </>,
    );
    expect(screen.getByText("Alex Morgan")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("Refreshing");
    fireEvent.click(screen.getByRole("button", { name: /previous page/i }));
    await waitFor(() => expect(onPageChange).toHaveBeenCalledWith(1));
  });
});
