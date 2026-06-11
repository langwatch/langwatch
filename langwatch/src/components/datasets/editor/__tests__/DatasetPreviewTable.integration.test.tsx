/**
 * @vitest-environment jsdom
 *
 * Integration tests for DatasetPreviewTable, the grid behind the
 * add-to-dataset mapping preview.
 *
 * The preview renders with the SAME shared cells as the evaluations workbench
 * (TableCell/EditableCell over DatasetTableContext), so JSON values format
 * across multiple lines, heavy values stay bounded, and double-click opens
 * the floating editor with the full value. These tests render the real
 * component tree and assert those behaviours plus the selection and
 * row-picking wiring.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

import type { DatasetColumns } from "~/server/datasets/types";
import { DatasetPreviewTable } from "../DatasetPreviewTable";

const SENTINEL = "SENTINEL_PAST_THE_CAP";
// Far past EditableCell's display cap (5000), marker at the very end so it
// only shows up in the full-value editor, never in the cell.
const HUGE_VALUE = "A".repeat(6000) + " " + SENTINEL;

function renderTable({
  rows,
  columns,
  ...props
}: {
  rows: Array<{ id?: string; selected?: boolean } & Record<string, unknown>>;
  columns: DatasetColumns;
  selectable?: boolean;
  onToggleRow?: (rowIndex: number, selected: boolean) => void;
  onToggleAll?: (selected: boolean) => void;
  onCellEdit?: (rowIndex: number, columnName: string, value: unknown) => void;
  onRowClick?: (rowIndex: number) => void;
}) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <DatasetPreviewTable rows={rows} columns={columns} {...props} />
    </ChakraProvider>,
  );
}

function getCellContaining(text: string): HTMLElement {
  const table = screen.getByTestId("dataset-preview-table");
  const cell = within(table)
    .getAllByRole("cell")
    .find((el) => (el.textContent ?? "").includes(text));
  expect(cell).toBeDefined();
  return cell!;
}

describe("DatasetPreviewTable (integration)", () => {
  afterEach(() => cleanup());

  describe("when a JSON-like column holds an object value", () => {
    /** @scenario JSON values render formatted in the preview */
    it("renders it as indented JSON, not one flat line", () => {
      renderTable({
        rows: [{ id: "row-1", spans: { name: "llm_call", tokens: [1, 2] } }],
        columns: [{ name: "spans", type: "json" }],
      });

      const cell = getCellContaining("llm_call");
      // Formatted JSON has the key indented on its own line.
      expect(cell.textContent).toContain('"name": "llm_call"');
      expect(cell.textContent).toContain("\n");
    });
  });

  describe("when a cell holds a value larger than the display cap", () => {
    /** @scenario A heavy mapped value stays bounded in the preview cell */
    it("renders a bounded value, not the whole blob", () => {
      renderTable({
        rows: [{ id: "row-1", payload: HUGE_VALUE }],
        columns: [{ name: "payload", type: "string" }],
      });

      const cell = getCellContaining("AAAA");
      expect(cell.textContent).toContain("(truncated)");
      expect(cell.textContent).not.toContain(SENTINEL);
    });
  });

  describe("when an editable cell is double-clicked", () => {
    /** @scenario Double-clicking a preview cell opens it for editing */
    it("opens the editor with the full value and saves the edit back", async () => {
      const user = userEvent.setup();
      const onCellEdit = vi.fn();
      renderTable({
        rows: [{ id: "row-1", payload: HUGE_VALUE }],
        columns: [{ name: "payload", type: "string" }],
        onCellEdit,
      });

      await user.dblClick(getCellContaining("AAAA"));

      const editor = await screen.findByRole("textbox");
      // The editor holds the FULL value, marker included.
      expect((editor as HTMLTextAreaElement).value).toContain(SENTINEL);

      await user.clear(editor);
      await user.type(editor, "edited value");
      await user.keyboard("{Enter}");

      expect(onCellEdit).toHaveBeenCalledWith(0, "payload", "edited value");
    });

    /** @scenario Double-clicking a preview cell opens it for editing */
    it("parses JSON-like column edits back to a value", async () => {
      const user = userEvent.setup();
      const onCellEdit = vi.fn();
      renderTable({
        rows: [{ id: "row-1", spans: { a: 1 } }],
        columns: [{ name: "spans", type: "json" }],
        onCellEdit,
      });

      await user.dblClick(getCellContaining('"a": 1'));
      const editor = await screen.findByRole("textbox");
      await user.clear(editor);
      // "{{" and "[[" escape the literal braces in userEvent.type
      await user.type(editor, '{{"a": 2}');
      await user.keyboard("{Enter}");

      expect(onCellEdit).toHaveBeenCalledWith(0, "spans", { a: 2 });
    });
  });

  describe("when no edit handler is provided", () => {
    /** @scenario Preview cells without an edit handler stay read-only */
    it("double-click does not open an editor", async () => {
      const user = userEvent.setup();
      renderTable({
        rows: [{ id: "row-1", payload: "hello" }],
        columns: [{ name: "payload", type: "string" }],
      });

      await user.dblClick(getCellContaining("hello"));

      expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    });
  });

  describe("when the selection checkboxes are used", () => {
    /** @scenario Selecting a single preview row toggles only that row */
    it("toggles a single row", async () => {
      const user = userEvent.setup();
      const onToggleRow = vi.fn();
      renderTable({
        rows: [{ id: "row-1", selected: false, payload: "hello" }],
        columns: [{ name: "payload", type: "string" }],
        selectable: true,
        onToggleRow,
      });

      await user.click(screen.getByLabelText("Select row 1"));

      expect(onToggleRow).toHaveBeenCalledWith(0, true);
    });

    /** @scenario The header checkbox toggles every preview row */
    it("toggles all rows from the header", async () => {
      const user = userEvent.setup();
      const onToggleAll = vi.fn();
      renderTable({
        rows: [{ id: "row-1", selected: false, payload: "hello" }],
        columns: [{ name: "payload", type: "string" }],
        selectable: true,
        onToggleAll,
      });

      await user.click(screen.getByLabelText("Select all rows"));

      expect(onToggleAll).toHaveBeenCalledWith(true);
    });
  });

  describe("when a row-picking handler is provided", () => {
    it("clicking a row reports its index and selected rows are marked", async () => {
      const user = userEvent.setup();
      const onRowClick = vi.fn();
      renderTable({
        rows: [
          { id: "row-1", selected: false, payload: "first" },
          { id: "row-2", selected: true, payload: "second" },
        ],
        columns: [{ name: "payload", type: "string" }],
        onRowClick,
      });

      await user.click(getCellContaining("first"));
      expect(onRowClick).toHaveBeenCalledWith(0);

      const selectedRow = getCellContaining("second").closest("tr");
      expect(selectedRow).toHaveAttribute("data-selected", "true");
    });
  });
});
