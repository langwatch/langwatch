/**
 * @vitest-environment jsdom
 *
 * Header drag-to-reorder vs sort interplay in TraceTableShell:
 * the column LABEL is the drag zone (data-column-drag-handle), the
 * sort chevron sits outside it, a plain click on the label still
 * toggles sorting, and the synthetic click fired right after a drag
 * is swallowed so dropping a column doesn't also sort it.
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import {
  type ColumnDef,
  getCoreRowModel,
  getSortedRowModel,
  type SortingState,
  type Table as TanstackTable,
  useReactTable,
} from "@tanstack/react-table";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

import { TraceTableShell } from "../TraceTableShell";

interface Row {
  name: string;
  duration: number;
  status: string;
}

const rows: Row[] = [
  { name: "alpha", duration: 10, status: "ok" },
  { name: "beta", duration: 20, status: "error" },
];

const columns: ColumnDef<Row>[] = [
  // Sortable + reorderable.
  { id: "name", accessorKey: "name", header: "Name", size: 120 },
  // Non-sortable + reorderable.
  {
    id: "status",
    accessorKey: "status",
    header: "Status",
    size: 80,
    enableSorting: false,
  },
  { id: "duration", accessorKey: "duration", header: "Duration", size: 80 },
];

let lastTable: TanstackTable<Row> | undefined;

function Harness({
  onColumnReorder = () => undefined,
}: {
  onColumnReorder?: (ids: string[]) => void;
}) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });
  lastTable = table;
  return (
    <ChakraProvider value={defaultSystem}>
      <TraceTableShell
        table={table}
        minWidth="280px"
        onColumnReorder={onColumnReorder}
        pinnedColumnIds={new Set()}
      >
        <tbody />
      </TraceTableShell>
    </ChakraProvider>
  );
}

// jsdom has no PointerEvent; dnd-kit's PointerSensor requires
// `isPrimary` + `button` on the activator event, so we polyfill a
// minimal PointerEvent on top of MouseEvent for the drag simulation.
class FakePointerEvent extends MouseEvent {
  public readonly pointerId: number;
  public readonly isPrimary: boolean;
  public readonly pointerType: string;
  constructor(type: string, init: PointerEventInit = {}) {
    super(type, { bubbles: true, cancelable: true, ...init });
    this.pointerId = init.pointerId ?? 1;
    this.isPrimary = init.isPrimary ?? true;
    this.pointerType = init.pointerType ?? "mouse";
  }
}

beforeAll(() => {
  // @ts-expect-error — jsdom lacks PointerEvent; minimal polyfill for dnd-kit.
  window.PointerEvent = FakePointerEvent;
});

afterEach(() => {
  cleanup();
  lastTable = undefined;
});

const getDragHandle = (label: string): HTMLElement => {
  const labelEl = screen.getByText(label);
  const handle = labelEl.closest<HTMLElement>("[data-column-drag-handle]");
  if (!handle) throw new Error(`no drag handle wrapping "${label}"`);
  return handle;
};

describe("TraceTableShell header drag/sort interplay", () => {
  describe("given a reorderable sortable column", () => {
    it("marks the label as the drag zone and keeps the chevron outside it", () => {
      render(<Harness />);
      const handle = getDragHandle("Name");
      expect(handle).toHaveAttribute("data-column-drag-handle", "true");

      // The chevron <svg> lives in the same sort button but must NOT
      // be inside the drag zone — hovering it shows pointer, not grab,
      // and pressing it can never start a reorder.
      const sortButton = handle.closest("button");
      expect(sortButton).not.toBeNull();
      const chevron = sortButton!.querySelector("svg");
      expect(chevron).not.toBeNull();
      expect(chevron!.closest("[data-column-drag-handle]")).toBeNull();
    });

    describe("when the label is clicked plainly", () => {
      it("toggles the column's sort state", () => {
        render(<Harness />);
        expect(lastTable!.getColumn("name")!.getIsSorted()).toBe(false);

        fireEvent.click(screen.getByText("Name"));
        expect(lastTable!.getColumn("name")!.getIsSorted()).toBe("asc");

        fireEvent.click(screen.getByText("Name"));
        expect(lastTable!.getColumn("name")!.getIsSorted()).toBe("desc");
      });
    });

    describe("when a drag has just ended", () => {
      it("swallows the synthetic click so dropping does not also sort", async () => {
        const onColumnReorder = vi.fn();
        render(<Harness onColumnReorder={onColumnReorder} />);
        const handle = getDragHandle("Name");

        // Drive dnd-kit's PointerSensor: pointerdown on the drag zone,
        // move past the 5px activation distance, then release. The
        // browser (jsdom included via fireEvent) then delivers the
        // synthetic click to the sort button, which must be swallowed.
        await act(async () => {
          handle.dispatchEvent(
            new FakePointerEvent("pointerdown", { clientX: 10, clientY: 10 }),
          );
        });
        await act(async () => {
          document.dispatchEvent(
            new FakePointerEvent("pointermove", { clientX: 40, clientY: 10 }),
          );
        });
        // The browser delivers the synthetic click in the same task as
        // pointerup, BEFORE the setTimeout(0) that releases the
        // suppression — so fire it inside the same act() rather than
        // after the await, where a slow event loop (CI) could let the
        // release timer run first and turn this test flaky.
        await act(async () => {
          document.dispatchEvent(
            new FakePointerEvent("pointerup", { clientX: 40, clientY: 10 }),
          );
          fireEvent.click(screen.getByText("Name"));
        });
        expect(lastTable!.getColumn("name")!.getIsSorted()).toBe(false);

        // Once the suppression ref clears (next tick) AND dnd-kit drops
        // its own capture-phase click-stopper (50ms after detach),
        // plain clicks sort again.
        await act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 60));
        });
        fireEvent.click(screen.getByText("Name"));
        expect(lastTable!.getColumn("name")!.getIsSorted()).toBe("asc");
      });
    });
  });

  describe("given a non-sortable reorderable column", () => {
    it("renders its label as a grab-cursor drag handle without a sort button", () => {
      render(<Harness />);
      const handle = getDragHandle("Status");
      expect(handle).toHaveAttribute("data-column-drag-handle", "true");
      expect(handle.closest("button")).toBeNull();
      expect(getComputedStyle(handle).cursor).toBe("grab");
    });
  });
});
