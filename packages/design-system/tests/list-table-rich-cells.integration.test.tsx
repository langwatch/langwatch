// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ListTable } from "../src/components/layout/list-table.tsx";
import { renderWithDesignSystem } from "../src/testing/index.tsx";
import {
  ChatCell,
  DiffCell,
  ImageCell,
  JsonCell,
  MarkdownCell,
  MeasuredRichTable,
  ToolTreeCell,
  makeRichRows,
} from "../src/workshop/list-table-rich-cells.tsx";

/** ResizeObserver callbacks by node, so a test can say "this row grew". */
const watchers = new Map<Element, () => void>();
const heights = new Map<Element, number>();

class FakeResizeObserver {
  constructor(private readonly callback: () => void) {}
  observe(node: Element) {
    watchers.set(node, this.callback);
  }
  unobserve(node: Element) {
    watchers.delete(node);
  }
  disconnect() {}
}

beforeEach(() => {
  watchers.clear();
  heights.clear();
  Object.defineProperty(window, "ResizeObserver", {
    configurable: true,
    value: FakeResizeObserver,
  });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    const height = heights.get(this) ?? (this.tagName === "TBODY" ? 200 : 0);
    return {
      height,
      width: 100,
      top: 0,
      left: 0,
      right: 100,
      bottom: height,
      x: 0,
      y: 0,
      toJSON() {},
    };
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const rows = makeRichRows(60);
const first = rows[0]!;

const RENDERERS = [
  ["markdown", MarkdownCell],
  ["tool tree", ToolTreeCell],
  ["json", JsonCell],
  ["chat", ChatCell],
  ["image", ImageCell],
  ["diff", DiffCell],
] as const;

describe("a measured virtual ListTable hosting rich cells", () => {
  /** @scenario Rich cells are hosted unchanged by the table shell */
  it.each(RENDERERS)("renders the %s cell exactly as it renders with no shell", (_name, Cell) => {
    const spy = vi.fn(Cell);
    const baseline = renderWithDesignSystem(<Cell row={first} />);
    const bare = baseline.container.innerHTML;
    baseline.unmount();

    const { container } = renderWithDesignSystem(
      <ListTable>
        <ListTable.Body>
          <ListTable.Row>
            <ListTable.Cell valign="top">{spy({ row: first })}</ListTable.Cell>
          </ListTable.Row>
        </ListTable.Body>
      </ListTable>,
    );
    const cell = container.querySelector("td");
    expect(cell?.innerHTML).toBe(bare);
    expect(spy).toHaveBeenCalledWith({ row: first });
    expect(spy.mock.calls[0]).toHaveLength(1);
  });

  /** @scenario Rich cells are hosted unchanged by the table shell */
  it("keeps a 5,000-character JSON value whole in its cell", () => {
    renderWithDesignSystem(
      <ListTable>
        <ListTable.Body>
          <ListTable.Row>
            <ListTable.Cell>
              <JsonCell row={first} />
            </ListTable.Cell>
          </ListTable.Row>
        </ListTable.Body>
      </ListTable>,
    );
    const text = document.querySelector("td pre")?.textContent ?? "";
    expect(text.length).toBeGreaterThan(5000);
    expect(text).toBe(JSON.stringify(first.output));
  });

  /** @scenario A measured virtual table re-measures a row whose cell expands */
  it("re-measures the row group when a tool-call node expands", async () => {
    const user = userEvent.setup();
    renderWithDesignSystem(<MeasuredRichTable rows={rows} />);
    const group = document.querySelector("tbody[data-index='0']");
    if (!group) throw new Error("first group missing");
    expect(group).toHaveAttribute("data-measured", "200");
    await user.click(
      within(group as HTMLElement).getByRole("button", { name: "Expand search_orders" }),
    );
    heights.set(group, 340);
    act(() => watchers.get(group)?.());
    expect(group).toHaveAttribute("data-measured", "340");
  });

  /** @scenario A measured virtual table reaches its last row and keeps row indexes */
  it("scrolls to the last row, with indexes that keep counting", () => {
    renderWithDesignSystem(<MeasuredRichTable rows={rows} />);
    const scroller = screen.getByTestId("scroller");
    expect(screen.queryByText("Run 60")).toBeNull();
    fireEvent.scroll(scroller, { target: { scrollTop: 60 * 200 } });
    const last = screen.getByText("Run 60").closest("tr");
    expect(last).toHaveAttribute("aria-rowindex", "61");
    expect(screen.getByRole("table")).toHaveAttribute("aria-rowcount", "61");
  });

  /** @scenario A measured virtual table keeps selection and expansion across scrolling */
  it("selects and expands rows around the rich cells", async () => {
    const user = userEvent.setup();
    renderWithDesignSystem(<MeasuredRichTable rows={rows} />);
    await user.click(screen.getByRole("checkbox", { name: "Select Run 1" }));
    expect(screen.getByRole("checkbox", { name: "Select Run 1" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /Select all 60 rows/ })).toBePartiallyChecked();
    const toggle = screen.getByRole("button", { name: "Show details for Run 1" });
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(document.getElementById("detail-row-0")).toHaveAttribute("aria-rowindex", "3");
  });
});
