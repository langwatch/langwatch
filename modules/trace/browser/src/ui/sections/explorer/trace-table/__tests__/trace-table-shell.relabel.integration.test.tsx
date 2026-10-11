// The shell reads one TanStack instance whose identity never changes, so its
// headers must follow the columns and the sort state on every render.
// @vitest-environment jsdom

import { DesignSystemProvider } from "@langwatch/design-system/provider";
import {
  type ColumnDef,
  getCoreRowModel,
  getSortedRowModel,
  type SortingState,
  useReactTable,
} from "@tanstack/react-table";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";

import { TraceTableShell } from "../trace-table-shell.tsx";

interface Row {
  label: string;
  count: number;
}

const rows: Row[] = [
  { label: "alpha", count: 1 },
  { label: "beta", count: 2 },
];

function columnsFor(groupLabel: string): ColumnDef<Row>[] {
  return [
    { id: "group", accessorKey: "label", header: groupLabel, size: 120 },
    { id: "count", accessorKey: "count", header: "Traces", size: 80 },
  ];
}

function Harness({ groupLabel }: { groupLabel: string }) {
  const [sorting, setSorting] = useState<SortingState>([{ id: "count", desc: true }]);
  const table = useReactTable({
    data: rows,
    columns: columnsFor(groupLabel),
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    enableSortingRemoval: false,
  });
  return (
    <DesignSystemProvider forcedTheme="light">
      <TraceTableShell table={table} minWidth="280px">
        <tbody />
      </TraceTableShell>
    </DesignSystemProvider>
  );
}

const headerCell = (label: string): HTMLElement => {
  const cell = screen.getByText(label).closest<HTMLElement>("th");
  if (!cell) throw new Error(`no header cell for "${label}"`);
  return cell;
};

afterEach(() => {
  cleanup();
});

describe("TraceTableShell", () => {
  describe("given a grouped table switched from By Model to By Service", () => {
    /** @scenario "Switching between two groupings relabels the group column" */
    it("relabels the group column header", () => {
      const { rerender } = render(<Harness groupLabel="Model" />);
      expect(headerCell("Model")).toBeInTheDocument();

      rerender(<Harness groupLabel="Service" />);

      expect(headerCell("Service")).toBeInTheDocument();
      expect(screen.queryByText("Model")).not.toBeInTheDocument();
    });

    describe("when another header is sorted afterwards", () => {
      it("moves the sort direction onto that header", () => {
        const { rerender } = render(<Harness groupLabel="Model" />);
        rerender(<Harness groupLabel="Service" />);
        expect(headerCell("Traces")).toHaveAttribute("aria-sort", "descending");

        fireEvent.click(screen.getByText("Service"));

        expect(headerCell("Service")).toHaveAttribute("aria-sort", "ascending");
        expect(headerCell("Traces")).toHaveAttribute("aria-sort", "none");
      });
    });
  });
});
