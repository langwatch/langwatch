// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { createPortal } from "react-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ListTable } from "../src/components/layout/list-table.tsx";
import { renderWithDesignSystem } from "../src/testing/index.tsx";
import { triState } from "../src/workshop/list-table-rich-cells.tsx";

afterEach(cleanup);

/** Props a part must refuse: spread in at runtime, past the types. */
const COSMETIC = {
  style: { color: "red" },
  className: "painted",
  css: { color: "red" },
  bg: "red",
};

describe("ListTable part closure", () => {
  /** @scenario List table parts ignore props they do not declare */
  it("drops cosmetic props passed past the types and keeps data attributes", () => {
    const spread = (extra: object) => extra;
    renderWithDesignSystem(
      <ListTable>
        <ListTable.Header {...spread(COSMETIC)} data-testid="head">
          <ListTable.Row {...spread(COSMETIC)} data-testid="head-row">
            <ListTable.ColumnHeader {...spread(COSMETIC)} data-testid="column">
              Name
            </ListTable.ColumnHeader>
          </ListTable.Row>
        </ListTable.Header>
        <ListTable.Body {...spread(COSMETIC)} data-testid="body">
          <ListTable.Row {...spread(COSMETIC)} data-testid="row">
            <ListTable.Cell {...spread(COSMETIC)} data-testid="cell" mono truncate>
              Weather agent
            </ListTable.Cell>
          </ListTable.Row>
        </ListTable.Body>
      </ListTable>,
    );
    for (const id of ["head", "head-row", "column", "body", "row", "cell"]) {
      const element = screen.getByTestId(id);
      expect(element).not.toHaveClass("painted");
      expect(element).not.toHaveAttribute("style");
    }
  });

  /** @scenario List table parts ignore props they do not declare */
  it("closes SortHeader, IdCell, ActionCell and SpanRow too", () => {
    const spread = (extra: object) => extra;
    renderWithDesignSystem(
      <ListTable>
        <ListTable.Header>
          <ListTable.Row>
            <ListTable.SortHeader {...spread(COSMETIC)} sorted={false} onSort={() => undefined}>
              Created
            </ListTable.SortHeader>
          </ListTable.Row>
        </ListTable.Header>
        <ListTable.Body>
          <ListTable.Row>
            <ListTable.IdCell {...spread(COSMETIC)} value="trace_0123456789" label="trace ID" />
            <ListTable.ActionCell {...spread(COSMETIC)}>
              <button type="button">Menu</button>
            </ListTable.ActionCell>
          </ListTable.Row>
          <ListTable.SpanRow {...spread(COSMETIC)} columns={2}>
            note
          </ListTable.SpanRow>
        </ListTable.Body>
      </ListTable>,
    );
    for (const element of document.querySelectorAll("th, td, tr")) {
      expect(element).not.toHaveClass("painted");
      expect(element).not.toHaveAttribute("style");
    }
  });
});

describe("ListTable row activation", () => {
  function Rows({
    onRow,
    onName,
    onNavigate,
    disabled = false,
  }: {
    onRow: () => void;
    onName?: () => void;
    onNavigate?: (href: string) => void;
    disabled?: boolean;
  }) {
    const [checked, setChecked] = useState(false);
    return (
      <ListTable>
        <ListTable.Body>
          <ListTable.Row onActivate={onRow} disabled={disabled} data-testid="row">
            <ListTable.SelectCell
              checked={checked}
              onCheckedChange={(a) => setChecked(a.checked)}
              label="Select Weather agent"
            />
            <ListTable.Cell>
              {onNavigate ? (
                <ListTable.RowAction href="/agents/1" onNavigate={(a) => onNavigate(a.href)}>
                  Weather agent
                </ListTable.RowAction>
              ) : (
                <ListTable.RowAction onActivate={onName ?? onRow}>
                  Weather agent
                </ListTable.RowAction>
              )}
            </ListTable.Cell>
            <ListTable.Cell data-testid="plain">12 runs</ListTable.Cell>
            <ListTable.Cell stopRowActivation data-testid="stopped">
              <span>spend</span>
            </ListTable.Cell>
            <ListTable.Cell data-testid="portal-cell">
              {createPortal(<button type="button">In a portal</button>, document.body)}
            </ListTable.Cell>
            <ListTable.ActionCell>
              <button type="button">Row menu</button>
            </ListTable.ActionCell>
          </ListTable.Row>
        </ListTable.Body>
      </ListTable>
    );
  }

  /** @scenario A row opens by mouse and keeps table semantics */
  it("opens on a click of the row surface and adds no tab stop, role or key handler", async () => {
    const user = userEvent.setup();
    const onRow = vi.fn();
    renderWithDesignSystem(<Rows onRow={onRow} />);
    const row = screen.getByTestId("row");
    expect(row).not.toHaveAttribute("tabindex");
    expect(row.getAttribute("role")).toBeNull();
    await user.click(screen.getByTestId("plain"));
    expect(onRow).toHaveBeenCalledTimes(1);
    await user.click(screen.getByTestId("stopped"));
    await user.click(within(screen.getByTestId("stopped")).getByText("spend"));
    expect(onRow).toHaveBeenCalledTimes(1);
  });

  /** @scenario Click, Enter and Space cause exactly one action */
  it("runs the row action once for click, Enter and Space, not the row", async () => {
    const user = userEvent.setup();
    const onRow = vi.fn();
    const onName = vi.fn();
    renderWithDesignSystem(<Rows onRow={onRow} onName={onName} />);
    const name = screen.getByRole("button", { name: "Weather agent" });
    await user.click(name);
    expect(onName).toHaveBeenCalledTimes(1);
    name.focus();
    await user.keyboard("{Enter}");
    expect(onName).toHaveBeenCalledTimes(2);
    await user.keyboard(" ");
    expect(onName).toHaveBeenCalledTimes(3);
    expect(onRow).not.toHaveBeenCalled();
  });

  /** @scenario Click, Enter and Space cause exactly one action */
  it("ignores clicks from checkboxes, action menus and portals", async () => {
    const user = userEvent.setup();
    const onRow = vi.fn();
    renderWithDesignSystem(<Rows onRow={onRow} />);
    await user.click(screen.getByRole("checkbox", { name: "Select Weather agent" }));
    await user.click(screen.getByRole("button", { name: "Row menu" }));
    await user.click(screen.getByRole("button", { name: "In a portal" }));
    expect(onRow).not.toHaveBeenCalled();
  });

  /** @scenario A row action that is a link routes in place and leaves new tabs to the browser */
  it("renders a real link, routes a plain click and leaves modified clicks alone", async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    const onRow = vi.fn();
    renderWithDesignSystem(<Rows onRow={onRow} onNavigate={onNavigate} />);
    const link = screen.getByRole("link", { name: "Weather agent" });
    expect(link).toHaveAttribute("href", "/agents/1");
    await user.click(link);
    expect(onNavigate).toHaveBeenCalledWith("/agents/1");
    await user.keyboard("{Control>}");
    await user.click(link);
    await user.keyboard("{/Control}");
    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(onRow).not.toHaveBeenCalled();
  });

  /** @scenario A disabled row shares one gate */
  it("never activates a disabled row, its row action or its checkbox", async () => {
    const user = userEvent.setup();
    const onRow = vi.fn();
    renderWithDesignSystem(<Rows onRow={onRow} disabled />);
    await user.click(screen.getByTestId("plain"));
    expect(screen.getByRole("button", { name: "Weather agent" })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "Select Weather agent" })).toBeDisabled();
    expect(onRow).not.toHaveBeenCalled();
  });

  /** @scenario A row can prefetch and report busy */
  it("prefetches on pointer entry and focus within, and reports a busy row", async () => {
    const user = userEvent.setup();
    const onPrefetch = vi.fn();
    renderWithDesignSystem(
      <ListTable>
        <ListTable.Body>
          <ListTable.Row onPrefetch={onPrefetch} aria-busy data-testid="row">
            <ListTable.Cell>
              <ListTable.RowAction onActivate={() => undefined}>Open</ListTable.RowAction>
            </ListTable.Cell>
          </ListTable.Row>
        </ListTable.Body>
      </ListTable>,
    );
    expect(screen.getByTestId("row")).toHaveAttribute("aria-busy", "true");
    await user.hover(screen.getByTestId("row"));
    expect(onPrefetch).toHaveBeenCalled();
    onPrefetch.mockClear();
    await user.tab();
    expect(onPrefetch).toHaveBeenCalled();
  });
});

describe("ListTable selection and sorting under a TanStack-style cell loop", () => {
  const columns = ["name", "created"] as const;
  const people = [
    { id: "a", name: "Ada" },
    { id: "b", name: "Grace" },
  ];

  function Grid({ onSort }: { onSort: (args: { multi: boolean; column: string }) => void }) {
    const [selected, setSelected] = useState<string[]>([]);
    return (
      <ListTable>
        <ListTable.Header>
          <ListTable.Row>
            {["select", ...columns].map((id) =>
              id === "select" ? (
                <ListTable.SelectHeader
                  key={id}
                  checked={triState({ count: selected.length, total: people.length })}
                  onCheckedChange={(a) => setSelected(a.checked ? people.map((p) => p.id) : [])}
                  label="Select all 2 rows"
                />
              ) : (
                <ListTable.SortHeader
                  key={id}
                  sorted={id === "name" ? "asc" : false}
                  sortRank={id === "name" ? 1 : undefined}
                  onSort={({ multi }) => onSort({ multi, column: id })}
                >
                  {id}
                </ListTable.SortHeader>
              ),
            )}
          </ListTable.Row>
        </ListTable.Header>
        <ListTable.Body>
          {people.map((person) => (
            <ListTable.Row key={person.id} selected={selected.includes(person.id)}>
              <ListTable.SelectCell
                checked={selected.includes(person.id)}
                onCheckedChange={(a) =>
                  setSelected((now) =>
                    a.checked ? [...now, person.id] : now.filter((id) => id !== person.id),
                  )
                }
                label={`Select ${person.name}`}
              />
              <ListTable.Cell>{person.name}</ListTable.Cell>
              <ListTable.Cell>today</ListTable.Cell>
            </ListTable.Row>
          ))}
        </ListTable.Body>
      </ListTable>
    );
  }

  /** @scenario Selection and sorting emit valid table structure and change state */
  it("keeps cells directly under rows and toggles with Space", async () => {
    const user = userEvent.setup();
    renderWithDesignSystem(<Grid onSort={() => undefined} />);
    expect(document.querySelectorAll("td td, th th, td th, th td")).toHaveLength(0);
    for (const cell of document.querySelectorAll("td, th")) {
      expect(cell.parentElement?.tagName).toBe("TR");
    }
    const ada = screen.getByRole("checkbox", { name: "Select Ada" });
    ada.focus();
    await user.keyboard(" ");
    expect(ada).toBeChecked();
    const all = screen.getByRole("checkbox", { name: "Select all 2 rows" });
    expect(all).toHaveAttribute("data-select-all");
    await user.click(all);
    expect(screen.getByRole("checkbox", { name: "Select Grace" })).toBeChecked();
    expect(screen.getAllByRole("row")[1]).toHaveAttribute("data-selected");
  });

  /** @scenario Sort headers report Shift and rank, with aria-sort on the header cell */
  it("sorts on pointer and keyboard, reports Shift, and announces rank", async () => {
    const user = userEvent.setup();
    const onSort = vi.fn();
    renderWithDesignSystem(<Grid onSort={onSort} />);
    const header = screen.getByRole("columnheader", { name: /name/ });
    expect(header).toHaveAttribute("aria-sort", "ascending");
    expect(within(header).getByRole("button")).not.toHaveAttribute("aria-sort");
    expect(header).toHaveTextContent("sort order 1");
    expect(screen.getByRole("columnheader", { name: /created/ })).toHaveAttribute(
      "aria-sort",
      "none",
    );
    const created = screen.getByRole("button", { name: /created/ });
    await user.click(created);
    expect(onSort).toHaveBeenLastCalledWith({ multi: false, column: "created" });
    await user.keyboard("{Shift>}");
    await user.click(created);
    await user.keyboard("{/Shift}");
    expect(onSort).toHaveBeenLastCalledWith({ multi: true, column: "created" });
    created.focus();
    await user.keyboard("{Enter}");
    expect(onSort).toHaveBeenLastCalledWith({ multi: false, column: "created" });
    await user.keyboard("{Shift>}{Enter}{/Shift}");
    expect(onSort).toHaveBeenLastCalledWith({ multi: true, column: "created" });
  });
});

describe("ListTable expansion", () => {
  /** @scenario An expand control names, toggles and controls its detail rows */
  it("keeps aria-expanded on the button, controls many ids and toggles once", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    const onRow = vi.fn();
    function Expanding() {
      const [open, setOpen] = useState(false);
      return (
        <ListTable>
          <ListTable.Body>
            <ListTable.Row expanded={open} onActivate={onRow} data-testid="row">
              <ListTable.ExpandCell
                expanded={open}
                onToggle={() => {
                  onToggle();
                  setOpen(!open);
                }}
                label="Show details for event 4f2a"
                panelId={["detail-1", "detail-2"]}
              />
              <ListTable.Cell>event 4f2a</ListTable.Cell>
            </ListTable.Row>
            {open && (
              <>
                <ListTable.SpanRow id="detail-1" columns={2}>
                  one
                </ListTable.SpanRow>
                <ListTable.SpanRow id="detail-2" columns={2}>
                  two
                </ListTable.SpanRow>
              </>
            )}
          </ListTable.Body>
        </ListTable>
      );
    }
    renderWithDesignSystem(<Expanding />);
    const toggle = screen.getByRole("button", { name: "Show details for event 4f2a" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByTestId("row")).not.toHaveAttribute("aria-expanded");
    await user.click(toggle);
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onRow).not.toHaveBeenCalled();
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    for (const id of (toggle.getAttribute("aria-controls") ?? "").split(" ")) {
      expect(document.getElementById(id)).not.toBeNull();
    }
    expect(toggle.getAttribute("aria-controls")).toBe("detail-1 detail-2");
  });
});

describe("ListTable busy state, indexing and geometry", () => {
  /** @scenario A loading table announces itself */
  it("sets aria-busy and a named status outside the skeleton rows", () => {
    renderWithDesignSystem(
      <ListTable loading loadingLabel="Loading more runs" data-testid="grid">
        <ListTable.Body>
          <ListTable.LoadingRows rows={2} columns={2} />
        </ListTable.Body>
      </ListTable>,
    );
    expect(screen.getByTestId("grid")).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("status")).toHaveTextContent("Loading more runs");
    expect(screen.getByRole("status").closest("table")).toBeNull();
    for (const row of document.querySelectorAll("[data-loading-row]")) {
      expect(row).toHaveAttribute("aria-hidden", "true");
    }
  });

  /** @scenario A virtual table keeps continuous row indexes and hidden padding rows */
  it("indexes rows across measured groups and hides the padding rows", () => {
    renderWithDesignSystem(
      <ListTable scroll="external" stickyHeader aria-rowcount={50} aria-colcount={2}>
        <ListTable.Header>
          <ListTable.Row aria-rowindex={1}>
            <ListTable.ColumnHeader aria-colindex={1}>Name</ListTable.ColumnHeader>
            <ListTable.ColumnHeader aria-colindex={2}>Kind</ListTable.ColumnHeader>
          </ListTable.Row>
        </ListTable.Header>
        <ListTable.Body>
          <ListTable.PaddingRow columns={2} height={400} />
        </ListTable.Body>
        <ListTable.Body data-index={8}>
          <ListTable.Row aria-rowindex={10}>
            <ListTable.Cell aria-colindex={1}>row 9</ListTable.Cell>
            <ListTable.Cell aria-colindex={2}>x</ListTable.Cell>
          </ListTable.Row>
          <ListTable.SpanRow id="d" columns={2} aria-rowindex={11}>
            detail
          </ListTable.SpanRow>
        </ListTable.Body>
        <ListTable.Body>
          <ListTable.PaddingRow columns={2} height={900} />
        </ListTable.Body>
      </ListTable>,
    );
    expect(screen.getByRole("table")).toHaveAttribute("aria-rowcount", "50");
    expect(document.querySelectorAll("tbody")).toHaveLength(3);
    expect(document.querySelector("tbody[data-index='8']")).not.toBeNull();
    expect(screen.getByText("row 9").closest("tr")).toHaveAttribute("aria-rowindex", "10");
    expect(document.getElementById("d")).toHaveAttribute("aria-rowindex", "11");
    for (const spacer of document.querySelectorAll("[data-padding-row]")) {
      expect(spacer).toHaveAttribute("aria-hidden", "true");
      expect(spacer).not.toHaveAttribute("aria-rowindex");
    }
  });

  /** @scenario Column widths become pixels and the group stays in the DOM */
  it("keeps a colgroup and turns small numbers into pixel widths", () => {
    renderWithDesignSystem(
      <ListTable tableLayout="fixed" rowHeight={49}>
        <ListTable.ColumnGroup>
          <ListTable.Column width={4} data-column="a" />
          <ListTable.Column width="fit" />
          <ListTable.Column width="12rem" />
        </ListTable.ColumnGroup>
        <ListTable.Body>
          <ListTable.Row>
            <ListTable.Cell width={6}>a</ListTable.Cell>
            <ListTable.Cell>b</ListTable.Cell>
            <ListTable.Cell>c</ListTable.Cell>
          </ListTable.Row>
        </ListTable.Body>
      </ListTable>,
    );
    const cols = document.querySelectorAll("colgroup > col");
    expect(cols).toHaveLength(3);
    expect(getComputedStyle(cols[0]!).width).toBe("4px");
    expect(getComputedStyle(cols[1]!).width).toBe("1%");
    expect(getComputedStyle(cols[2]!).width).toBe("192px");
    expect(getComputedStyle(screen.getByText("a")).width).toBe("6px");
    expect(getComputedStyle(screen.getByRole("table")).tableLayout).toBe("fixed");
  });
});

describe("ListTable empty rows", () => {
  const next = [
    { kind: "docs", label: "Read about keys", href: "https://example.com/keys" },
  ] as const;

  /** @scenario An empty row always carries a next step beside its callbacks */
  it("draws title, next step and the clear callback beside it", async () => {
    const user = userEvent.setup();
    const onClearFilters = vi.fn();
    renderWithDesignSystem(
      <ListTable>
        <ListTable.Body>
          <ListTable.EmptyRow
            columns={3}
            state="no-results"
            title="No keys match this scope"
            next={next}
            onClearFilters={onClearFilters}
          />
        </ListTable.Body>
      </ListTable>,
    );
    expect(screen.getByText(/No keys match this scope/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Read about keys" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(onClearFilters).toHaveBeenCalledTimes(1);
  });

  /** @scenario An empty row always carries a next step beside its callbacks */
  it("renders a failure as an alert with retry beside the next step", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    renderWithDesignSystem(
      <ListTable>
        <ListTable.Body>
          <ListTable.EmptyRow
            columns={3}
            state="error"
            title="Keys could not be loaded"
            next={next}
            onRetry={onRetry}
          />
        </ListTable.Body>
      </ListTable>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Keys could not be loaded");
    expect(screen.getByRole("link", { name: "Read about keys" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  /** @scenario An empty row always carries a next step beside its callbacks */
  it("does not compile without a non-empty next step", () => {
    const rejected = () => (
      <ListTable>
        <ListTable.Body>
          {/* @ts-expect-error next is required */}
          <ListTable.EmptyRow columns={1} state="empty" title="No keys yet" />
          {/* @ts-expect-error next must not be empty */}
          <ListTable.EmptyRow columns={1} state="empty" title="No keys yet" next={[]} />
        </ListTable.Body>
      </ListTable>
    );
    expect(rejected).toBeTypeOf("function");
  });
});
