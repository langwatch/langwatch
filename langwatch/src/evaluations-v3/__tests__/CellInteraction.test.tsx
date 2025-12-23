/**
 * @vitest-environment jsdom
 */
import React from "react";
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useEvaluationsV3Store } from "../hooks/useEvaluationsV3Store";

// Mock useDrawer
vi.mock("~/hooks/useDrawer", () => ({
  useDrawer: () => ({
    openDrawer: vi.fn(),
    closeDrawer: vi.fn(),
    isOpen: vi.fn(() => false),
    drawerParams: {},
  }),
}));

// Wrapper with Chakra provider
const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

type ColumnType = "checkbox" | "dataset" | "agent";

type CellMeta = {
  columnType: ColumnType;
  columnId: string;
};

type TableCellProps = {
  cellId: string;
  rowIndex: number;
  meta: CellMeta;
  value?: string;
  children?: React.ReactNode;
};

/**
 * Simplified cell component that replicates the renderCell behavior.
 * This tests the cell selection and interaction logic.
 */
const TableCell = ({ cellId, rowIndex, meta, value, children }: TableCellProps) => {
  const {
    ui,
    setSelectedCell,
    setEditingCell,
    toggleRowSelection,
  } = useEvaluationsV3Store((state) => ({
    ui: state.ui,
    setSelectedCell: state.setSelectedCell,
    setEditingCell: state.setEditingCell,
    toggleRowSelection: state.toggleRowSelection,
  }));

  const isSelected =
    ui.selectedCell?.row === rowIndex &&
    ui.selectedCell?.columnId === meta.columnId;

  const handleSelect = () => {
    setSelectedCell({ row: rowIndex, columnId: meta.columnId });
  };

  const handleActivate = () => {
    if (meta.columnType === "dataset") {
      setSelectedCell({ row: rowIndex, columnId: meta.columnId });
      setEditingCell({ row: rowIndex, columnId: meta.columnId });
    } else if (meta.columnType === "checkbox") {
      toggleRowSelection(rowIndex);
    }
  };

  return (
    <td
      data-testid={cellId}
      data-selected={isSelected}
      onClick={handleSelect}
      onDoubleClick={handleActivate}
      style={{
        outline: isSelected ? "2px solid blue" : "none",
      }}
    >
      {children ?? value}
    </td>
  );
};

/**
 * Test harness component that renders cells for testing.
 */
const CellTestHarness = () => {
  const { ui } = useEvaluationsV3Store((state) => ({
    ui: state.ui,
  }));

  return (
    <div>
      <table>
        <tbody>
          <tr>
            <TableCell
              cellId="checkbox-0"
              rowIndex={0}
              meta={{ columnType: "checkbox", columnId: "__checkbox__" }}
            />
            <TableCell
              cellId="input-0"
              rowIndex={0}
              meta={{ columnType: "dataset", columnId: "input" }}
              value="test value"
            />
            <TableCell
              cellId="output-0"
              rowIndex={0}
              meta={{ columnType: "dataset", columnId: "expected_output" }}
              value="expected"
            />
            <TableCell
              cellId="agent-0"
              rowIndex={0}
              meta={{ columnType: "agent", columnId: "agent.agent-1" }}
            />
          </tr>
          <tr>
            <TableCell
              cellId="checkbox-1"
              rowIndex={1}
              meta={{ columnType: "checkbox", columnId: "__checkbox__" }}
            />
            <TableCell
              cellId="input-1"
              rowIndex={1}
              meta={{ columnType: "dataset", columnId: "input" }}
              value="row 2"
            />
            <TableCell
              cellId="output-1"
              rowIndex={1}
              meta={{ columnType: "dataset", columnId: "expected_output" }}
              value="expected 2"
            />
            <TableCell
              cellId="agent-1"
              rowIndex={1}
              meta={{ columnType: "agent", columnId: "agent.agent-1" }}
            />
          </tr>
        </tbody>
      </table>
      <div data-testid="selected-cell">
        {ui.selectedCell
          ? `${ui.selectedCell.row}:${ui.selectedCell.columnId}`
          : "none"}
      </div>
      <div data-testid="editing-cell">
        {ui.editingCell
          ? `${ui.editingCell.row}:${ui.editingCell.columnId}`
          : "none"}
      </div>
      <div data-testid="selected-rows">
        {Array.from(ui.selectedRows).join(",")}
      </div>
    </div>
  );
};

describe("Cell interaction", () => {
  beforeEach(() => {
    useEvaluationsV3Store.getState().reset();
  });

  afterEach(() => {
    cleanup();
  });

  describe("Single click selection", () => {
    it("selects a dataset cell on click", async () => {
      render(<CellTestHarness />, { wrapper: Wrapper });

      const cell = screen.getByTestId("input-0");
      fireEvent.click(cell);

      await waitFor(() => {
        expect(screen.getByTestId("selected-cell")).toHaveTextContent("0:input");
      });
    });

    it("selects a checkbox cell on click", async () => {
      render(<CellTestHarness />, { wrapper: Wrapper });

      const cell = screen.getByTestId("checkbox-0");
      fireEvent.click(cell);

      await waitFor(() => {
        expect(screen.getByTestId("selected-cell")).toHaveTextContent("0:__checkbox__");
      });
    });

    it("selects an agent cell on click", async () => {
      render(<CellTestHarness />, { wrapper: Wrapper });

      const cell = screen.getByTestId("agent-0");
      fireEvent.click(cell);

      await waitFor(() => {
        expect(screen.getByTestId("selected-cell")).toHaveTextContent("0:agent.agent-1");
      });
    });

    it("changes selection when clicking different cell", async () => {
      render(<CellTestHarness />, { wrapper: Wrapper });

      // Click first cell
      fireEvent.click(screen.getByTestId("input-0"));
      await waitFor(() => {
        expect(screen.getByTestId("selected-cell")).toHaveTextContent("0:input");
      });

      // Click different cell
      fireEvent.click(screen.getByTestId("output-1"));
      await waitFor(() => {
        expect(screen.getByTestId("selected-cell")).toHaveTextContent("1:expected_output");
      });
    });
  });

  describe("Double click activation", () => {
    it("enters edit mode on double-click for dataset cell", async () => {
      render(<CellTestHarness />, { wrapper: Wrapper });

      const cell = screen.getByTestId("input-0");
      fireEvent.doubleClick(cell);

      await waitFor(() => {
        expect(screen.getByTestId("editing-cell")).toHaveTextContent("0:input");
      });
    });

    it("toggles row selection on double-click for checkbox cell", async () => {
      render(<CellTestHarness />, { wrapper: Wrapper });

      const cell = screen.getByTestId("checkbox-0");
      fireEvent.doubleClick(cell);

      await waitFor(() => {
        expect(screen.getByTestId("selected-rows")).toHaveTextContent("0");
      });
    });

    it("does not enter edit mode for agent cell on double-click", async () => {
      render(<CellTestHarness />, { wrapper: Wrapper });

      const cell = screen.getByTestId("agent-0");
      fireEvent.doubleClick(cell);

      await waitFor(() => {
        expect(screen.getByTestId("editing-cell")).toHaveTextContent("none");
      });
    });

    it("double-click on checkbox toggles selection without entering edit mode", async () => {
      render(<CellTestHarness />, { wrapper: Wrapper });

      fireEvent.doubleClick(screen.getByTestId("checkbox-1"));

      await waitFor(() => {
        expect(screen.getByTestId("selected-rows")).toHaveTextContent("1");
        expect(screen.getByTestId("editing-cell")).toHaveTextContent("none");
      });
    });
  });

  describe("Selection visual indicator", () => {
    it("shows selected state on cell data attribute", async () => {
      render(<CellTestHarness />, { wrapper: Wrapper });

      const cell = screen.getByTestId("input-0");
      expect(cell).toHaveAttribute("data-selected", "false");

      fireEvent.click(cell);

      await waitFor(() => {
        expect(cell).toHaveAttribute("data-selected", "true");
      });
    });

    it("removes selected state from previous cell", async () => {
      render(<CellTestHarness />, { wrapper: Wrapper });

      const cell1 = screen.getByTestId("input-0");
      const cell2 = screen.getByTestId("output-0");

      fireEvent.click(cell1);
      await waitFor(() => {
        expect(cell1).toHaveAttribute("data-selected", "true");
      });

      fireEvent.click(cell2);
      await waitFor(() => {
        expect(cell1).toHaveAttribute("data-selected", "false");
        expect(cell2).toHaveAttribute("data-selected", "true");
      });
    });
  });

  describe("Edit mode combined with selection", () => {
    it("selects and enters edit mode on double-click", async () => {
      render(<CellTestHarness />, { wrapper: Wrapper });

      const cell = screen.getByTestId("input-0");
      fireEvent.doubleClick(cell);

      await waitFor(() => {
        expect(screen.getByTestId("selected-cell")).toHaveTextContent("0:input");
        expect(screen.getByTestId("editing-cell")).toHaveTextContent("0:input");
      });
    });
  });
});
