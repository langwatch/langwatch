/**
 * @vitest-environment jsdom
 *
 * Integration tests for DatasetPreviewTable, the read-only grid behind the
 * add-to-dataset mapping preview.
 *
 * A customer mapped a 100-span trace (huge serialized JSON) into a column and
 * the preview became unreadable: the cell rendered the entire blob and there
 * was no way to read it. These tests render the real component tree and assert
 * the two behaviours that fix it: the per-cell text is capped so a heavy value
 * stays cheap to render, and double-clicking a cell opens the full value in an
 * expanded dialog. They also pin the selection checkbox wiring so the
 * alignment fix did not break it.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

import type { DatasetColumns } from "~/server/datasets/types";
import { DatasetPreviewTable } from "../DatasetPreviewTable";

const SENTINEL = "SENTINEL_PAST_THE_CAP";
// A value far longer than the per-cell display cap, with a marker placed at the
// very end so it only shows up once the cell is expanded.
const HUGE_VALUE = "A".repeat(500) + " " + SENTINEL;

const columns: DatasetColumns = [{ name: "payload", type: "string" }];

function renderTable(overrides?: {
  onToggleRow?: (rowIndex: number, selected: boolean) => void;
  onToggleAll?: (selected: boolean) => void;
}) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <DatasetPreviewTable
        rows={[{ id: "row-1", selected: false, payload: HUGE_VALUE }]}
        columns={columns}
        selectable
        onToggleRow={overrides?.onToggleRow}
        onToggleAll={overrides?.onToggleAll}
      />
    </ChakraProvider>,
  );
}

/** The single data cell (skips the leading checkbox cell). */
function getPayloadCell(): HTMLElement {
  const table = screen.getByTestId("dataset-preview-table");
  const cell = within(table)
    .getAllByRole("cell")
    .find((el) => (el.textContent ?? "").startsWith("AAAA"));
  expect(cell).toBeDefined();
  return cell!;
}

describe("DatasetPreviewTable (integration)", () => {
  afterEach(() => cleanup());

  describe("when a cell holds a value larger than the display cap", () => {
    /** @scenario A heavy mapped value is capped in the preview cell */
    it("renders a truncated value, not the whole blob", () => {
      renderTable();
      const cell = getPayloadCell();

      // The cell text is bounded and ends with an ellipsis...
      expect(cell.textContent!.length).toBeLessThanOrEqual(301);
      expect(cell.textContent).toContain("…");
      // ...and the marker living past the cap is NOT in the DOM cell.
      expect(cell.textContent).not.toContain(SENTINEL);
    });
  });

  describe("when a cell is double-clicked", () => {
    /** @scenario Double-clicking a preview cell expands the full value */
    it("opens a dialog showing the full untruncated value", async () => {
      const user = userEvent.setup();
      renderTable();

      await user.dblClick(getPayloadCell());

      const dialog = await screen.findByRole("dialog");
      // The expanded dialog carries the full value, marker included.
      expect(dialog.textContent).toContain(SENTINEL);
    });
  });

  describe("when the selection checkboxes are used", () => {
    /** @scenario Selecting a single preview row toggles only that row */
    it("toggles a single row", async () => {
      const user = userEvent.setup();
      const onToggleRow = vi.fn();
      renderTable({ onToggleRow });

      await user.click(screen.getByLabelText("Select row 1"));

      expect(onToggleRow).toHaveBeenCalledWith(0, true);
    });

    /** @scenario The header checkbox toggles every preview row */
    it("toggles all rows from the header", async () => {
      const user = userEvent.setup();
      const onToggleAll = vi.fn();
      renderTable({ onToggleAll });

      await user.click(screen.getByLabelText("Select all rows"));

      expect(onToggleAll).toHaveBeenCalledWith(true);
    });
  });
});
