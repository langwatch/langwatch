// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ListTable } from "../src/components/layout/list-table.tsx";
import { SelectionActionBar } from "../src/components/layout/selection-action-bar.tsx";
import { TableToolbar } from "../src/components/layout/table-toolbar.tsx";
import { renderWithDesignSystem } from "../src/testing/index.tsx";

afterEach(cleanup);

const field = (name: string) => ({
  value: "",
  onChange: vi.fn(),
  placeholder: name,
  ariaLabel: name,
  testId: name.toLowerCase().replaceAll(" ", "-"),
});

describe("TableToolbar", () => {
  /** @scenario The toolbar is one row of search, lookup, filters, summary, columns and actions */
  it("draws a search and a distinct lookup, a summary and clear, then columns and actions", async () => {
    const user = userEvent.setup();
    const onClearFilters = vi.fn();
    renderWithDesignSystem(
      <TableToolbar
        search={field("Search models")}
        lookup={field("Find the rule for a model")}
        filters={<button type="button">Provider</button>}
        summary="12 of 40 models"
        onClearFilters={onClearFilters}
        actions={<button type="button">Export</button>}
        columns={{ columns: [{ value: "a", label: "A", visible: true }], onVisibleChange: vi.fn() }}
      />,
    );
    expect(screen.getAllByRole("searchbox")).toHaveLength(2);
    expect(screen.getByRole("searchbox", { name: "Search models" })).toHaveAttribute(
      "data-testid",
      "search-models",
    );
    expect(screen.getByRole("status")).toHaveTextContent("12 of 40 models");
    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(onClearFilters).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Export" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show or hide columns" })).toBeInTheDocument();
  });

  /** @scenario The toolbar is one row of search, lookup, filters, summary, columns and actions */
  it("disables the search inputs while loading and omits Clear filters when no filter is active", () => {
    renderWithDesignSystem(<TableToolbar search={field("Search models")} disabled />);
    expect(screen.getByRole("searchbox")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Clear filters" })).toBeNull();
  });

  /** @scenario An inline selection bar is the first band of the toolbar */
  it("draws an inline selection bar before the toolbar row", () => {
    renderWithDesignSystem(
      <TableToolbar
        search={field("Search models")}
        selection={{ label: "3 selected", onClear: vi.fn() }}
      />,
    );
    const bar = screen.getByRole("group", { name: "Selection actions" });
    expect(bar).toHaveAttribute("data-placement", "inline");
    expect(
      screen.getByRole("searchbox").compareDocumentPosition(bar) & Node.DOCUMENT_POSITION_PRECEDING,
    ).toBeTruthy();
  });

  /** @scenario The toolbar is one row of search, lookup, filters, summary, columns and actions */
  it("renders nothing when it has nothing to show", () => {
    const { container } = renderWithDesignSystem(<TableToolbar />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("ColumnPicker", () => {
  /** @scenario The column picker offers labelled checkbox items and locks a column */
  it("lists every column as a labelled checkbox item and reports a change", async () => {
    const user = userEvent.setup();
    const onVisibleChange = vi.fn();
    const onReset = vi.fn();
    renderWithDesignSystem(
      <TableToolbar
        columns={{
          columns: [
            { value: "name", label: "Name", visible: true, locked: true },
            { value: "owner", label: "Owner", visible: false },
            { value: "created", label: "Created", visible: true },
          ],
          onVisibleChange,
          onReset,
        }}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Show or hide columns" }));
    const name = await screen.findByRole("menuitemcheckbox", { name: "Name" });
    expect(name).toBeChecked();
    expect(name).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("menuitemcheckbox", { name: "Owner" })).not.toBeChecked();
    await user.click(screen.getByRole("menuitemcheckbox", { name: "Owner" }));
    expect(onVisibleChange).toHaveBeenCalledWith({ value: "owner", visible: true });
    await user.click(screen.getByRole("menuitem", { name: "Reset to default" }));
    expect(onReset).toHaveBeenCalledTimes(1);
  });
});

describe("SelectionActionBar", () => {
  /** @scenario The selection bar floats by default and sits in flow when inline */
  it("floats bottom-centre with a safe-area offset and a viewport max width", () => {
    renderWithDesignSystem(<SelectionActionBar label="2 selected" onClear={vi.fn()} />);
    const bar = screen.getByRole("group", { name: "Selection actions" });
    const style = getComputedStyle(bar);
    expect(style.position).toBe("fixed");
    expect(bar.getAttribute("data-bottom-floating-bar")).toBe("");
    expect(style.bottom).toContain("env(safe-area-inset-bottom)");
    expect(style.maxWidth).toBe("992px");
  });

  /** @scenario The selection bar floats by default and sits in flow when inline */
  it("sits in normal flow when inline, with no fixed position", () => {
    renderWithDesignSystem(
      <SelectionActionBar placement="inline" label="2 selected" onClear={vi.fn()} />,
    );
    const bar = screen.getByRole("group", { name: "Selection actions" });
    expect(getComputedStyle(bar).position).not.toBe("fixed");
    expect(bar).not.toHaveAttribute("data-bottom-floating-bar");
  });

  /** @scenario Clearing the selection returns focus to the table's select-all checkbox */
  it("moves focus to the table's select-all checkbox after Clear", async () => {
    const user = userEvent.setup();
    const onClear = vi.fn();
    renderWithDesignSystem(
      <>
        <ListTable id="agents">
          <ListTable.Header>
            <ListTable.Row>
              <ListTable.SelectHeader checked label="Select all" onCheckedChange={vi.fn()} />
            </ListTable.Row>
          </ListTable.Header>
        </ListTable>
        <SelectionActionBar
          placement="inline"
          forTable="agents"
          label="1 selected"
          onClear={onClear}
        />
      </>,
    );
    await user.click(
      within(screen.getByRole("group")).getByRole("button", { name: "Clear selection" }),
    );
    expect(onClear).toHaveBeenCalledTimes(1);
    // Focus lands a frame later, once the cleared header has rebuilt.
    await waitFor(() => expect(screen.getByRole("checkbox", { name: "Select all" })).toHaveFocus());
  });
});
