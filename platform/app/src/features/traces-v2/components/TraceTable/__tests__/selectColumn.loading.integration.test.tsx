/**
 * @vitest-environment jsdom
 *
 * The select column's header while the trace table is still loading. The
 * loading table is fed placeholder rows so the layout does not jump, and those
 * rows carry no trace: a "select all" over them hands the bulk actions ids that
 * address nothing, and deselecting cannot take them back out again because the
 * ids are gone from the table by then.
 * See specs/traces-v2/bulk-actions.feature.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { flexRender, getCoreRowModel, useReactTable } from "@tanstack/react-table";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";

import { useSelectionStore } from "@langwatch/trace-web";
import type { TraceListItem } from "../../../types/trace";
import { traceSelectColumnDef } from "../selectColumn";
import { buildTracePlaceholderRows } from "../skeletonPlaceholders";

const realRows = (): TraceListItem[] =>
  buildTracePlaceholderRows(2).map((row, index) => ({
    ...row,
    traceId: `trace-${index}`,
  }));

const SelectHeader = ({
  data,
  isLoading,
}: {
  data: TraceListItem[];
  isLoading: boolean;
}) => {
  const table = useReactTable({
    data,
    columns: [traceSelectColumnDef],
    meta: { isLoading },
    getCoreRowModel: getCoreRowModel(),
    getRowId: (row) => row.traceId,
  });
  const header = table.getHeaderGroups()[0]!.headers[0]!;
  return <>{flexRender(header.column.columnDef.header, header.getContext())}</>;
};

const renderHeader = (props: { data: TraceListItem[]; isLoading: boolean }) =>
  render(
    <ChakraProvider value={defaultSystem}>
      <SelectHeader {...props} />
    </ChakraProvider>,
  );

const selectAllButton = () =>
  screen.queryByRole("button", { name: "Select all on this page" });

const selection = () => Array.from(useSelectionStore.getState().traceIds);

beforeEach(() => {
  useSelectionStore.getState().clear();
});

afterEach(() => {
  cleanup();
});

describe("given the trace table's select column", () => {
  describe("when the page is still loading", () => {
    /** @scenario "Selecting all while the page is still loading selects nothing" */
    it("offers no select-all, so nothing can be selected", async () => {
      const user = userEvent.setup();
      renderHeader({ data: buildTracePlaceholderRows(50), isLoading: true });

      expect(selectAllButton()).not.toBeInTheDocument();

      for (const element of screen.queryAllByRole("button")) await user.click(element);
      expect(selection()).toEqual([]);
    });
  });

  describe("when the page has landed", () => {
    /** @scenario "Toggling the header checkbox selects every row on the page" */
    it("selects every trace on the page", async () => {
      const user = userEvent.setup();
      renderHeader({ data: realRows(), isLoading: false });

      await user.click(selectAllButton()!);

      expect(selection()).toEqual(["trace-0", "trace-1"]);
    });
  });

  describe("when placeholder rows outlive the loading flag", () => {
    /** @scenario "Selecting all while the page is still loading selects nothing" */
    it("selects the real traces and leaves the placeholders out", async () => {
      const user = userEvent.setup();
      renderHeader({
        data: [...buildTracePlaceholderRows(3), ...realRows()],
        isLoading: false,
      });

      await user.click(selectAllButton()!);

      expect(selection()).toEqual(["trace-0", "trace-1"]);
    });
  });
});
