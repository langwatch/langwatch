import { Box, Button, Checkbox, HStack, Portal, Text, Textarea } from "@chakra-ui/react";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type Cell,
} from "@tanstack/react-table";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  Code,
  Database,
  Hash,
  List,
  MessageSquare,
  Plus,
  Type,
} from "react-feather";

import { ColorfulBlockIcon } from "~/optimization_studio/components/ColorfulBlockIcons";
import { LLMIcon } from "~/components/icons/LLMIcon";
import { useEvaluationsV3Store } from "../hooks/useEvaluationsV3Store";
import type { AgentConfig, EvaluatorConfig } from "../types";
import { EditableCell } from "./DatasetSection/EditableCell";

// ============================================================================
// Types
// ============================================================================

type RowData = {
  rowIndex: number;
  dataset: Record<string, string>;
  agents: Record<string, unknown>;
  evaluators: Record<string, unknown>;
};

type SuperHeaderType = "dataset" | "agents" | "evaluators";

type ColumnType = "checkbox" | "dataset" | "agent" | "evaluator";

// ============================================================================
// Pulsing Dot Indicator (radar-style)
// ============================================================================

function PulsingDot() {
  return (
    <>
      <style>
        {`
          @keyframes evalRadar {
            0% { transform: scale(1); opacity: 0.6; }
            100% { transform: scale(2.5); opacity: 0; }
          }
        `}
      </style>
      <Box
        as="span"
        position="relative"
        display="inline-flex"
        alignItems="center"
        justifyContent="center"
        marginLeft={2}
      >
        {/* Expanding ring */}
        <Box
          as="span"
          position="absolute"
          width="8px"
          height="8px"
          borderRadius="full"
          bg="blue.300"
          style={{ animation: "evalRadar 1.5s ease-out infinite" }}
        />
        {/* Fixed center dot */}
        <Box
          as="span"
          position="relative"
          width="6px"
          height="6px"
          borderRadius="full"
          bg="blue.500"
        />
      </Box>
    </>
  );
}

// ============================================================================
// Column Type Icons
// ============================================================================

const ColumnTypeIcon = ({ type }: { type: string }) => {
  const iconProps = { size: 12, strokeWidth: 2.5 };

  switch (type) {
    case "string":
      return <Type {...iconProps} color="var(--chakra-colors-blue-500)" />;
    case "number":
      return <Hash {...iconProps} color="var(--chakra-colors-green-500)" />;
    case "json":
      return <List {...iconProps} color="var(--chakra-colors-purple-500)" />;
    case "chat_messages":
      return (
        <MessageSquare {...iconProps} color="var(--chakra-colors-orange-500)" />
      );
    default:
      return <Type {...iconProps} color="var(--chakra-colors-gray-400)" />;
  }
};

// ============================================================================
// Super Header Component
// ============================================================================

type SuperHeaderProps = {
  type: SuperHeaderType;
  colSpan: number;
  onAddClick?: () => void;
  showWarning?: boolean;
};

const superHeaderConfig: Record<
  SuperHeaderType,
  { title: string; color: string; icon: React.ReactNode }
> = {
  dataset: {
    title: "Dataset",
    color: "blue.400",
    icon: <Database size={14} />,
  },
  agents: {
    title: "Agents",
    color: "green.400",
    icon: <LLMIcon />,
  },
  evaluators: {
    title: "Evaluators",
    color: "#5FD15D",
    icon: <Check size={14} />,
  },
};

function SuperHeader({
  type,
  colSpan,
  onAddClick,
  showWarning,
}: SuperHeaderProps) {
  const config = superHeaderConfig[type];

  return (
    <th
      colSpan={colSpan}
      style={{
        padding: "12px 12px",
        paddingLeft: type === "dataset" ? "52px" : "12px",
        textAlign: "left",
        borderBottom: "1px solid var(--chakra-colors-gray-200)",
        backgroundColor: "white",
        height: "48px",
      }}
    >
      <HStack gap={2}>
        <ColorfulBlockIcon color={config.color} size="sm" icon={config.icon} />
        <Text fontWeight="semibold" fontSize="sm" color="gray.700">
          {config.title}
        </Text>
        {onAddClick && (
          <Button
            size="xs"
            variant="ghost"
            onClick={onAddClick}
            color="gray.500"
            _hover={{ color: "gray.700" }}
          >
            <Plus size={12} />
            Add {type === "agents" ? "Agent" : "Evaluator"}
            {showWarning && <PulsingDot />}
          </Button>
        )}
      </HStack>
    </th>
  );
}

// ============================================================================
// Selection Toolbar
// ============================================================================

type SelectionToolbarProps = {
  selectedCount: number;
  onRun: () => void;
  onDelete: () => void;
  onClear: () => void;
};

function SelectionToolbar({
  selectedCount,
  onRun,
  onDelete,
  onClear,
}: SelectionToolbarProps) {
  if (selectedCount === 0) return null;

  return (
    <HStack
      position="fixed"
      bottom={4}
      left="50%"
      transform="translateX(-50%)"
      bg="gray.800"
      color="white"
      paddingX={4}
      paddingY={2}
      borderRadius="lg"
      boxShadow="lg"
      gap={3}
      zIndex={100}
    >
      <Text fontSize="sm">{selectedCount} selected</Text>
      <Button
        size="sm"
        variant="ghost"
        colorPalette="whiteAlpha"
        onClick={onRun}
      >
        ▶ Run
      </Button>
      <Button
        size="sm"
        variant="ghost"
        colorPalette="whiteAlpha"
        onClick={onDelete}
      >
        🗑 Delete
      </Button>
      <Button
        size="sm"
        variant="ghost"
        colorPalette="whiteAlpha"
        onClick={onClear}
      >
        ✕
      </Button>
    </HStack>
  );
}

// ============================================================================
// Selectable Cell Wrapper - handles selection outline for any cell type
// ============================================================================

type SelectableCellProps = {
  columnId: string;
  row: number;
  columnType: ColumnType;
  children: React.ReactNode;
  onSelect: () => void;
  onActivate: () => void; // Double-click or Enter
};

function SelectableCell({
  columnId,
  row,
  columnType,
  children,
  onSelect,
  onActivate,
}: SelectableCellProps) {
  const { ui } = useEvaluationsV3Store((state) => ({ ui: state.ui }));

  const isSelected =
    ui.selectedCell?.row === row && ui.selectedCell?.columnId === columnId;

  return (
    <td
      onClick={onSelect}
      onDoubleClick={onActivate}
      style={{
        outline: isSelected
          ? "2px solid var(--chakra-colors-blue-500)"
          : "none",
        outlineOffset: "-1px",
        position: isSelected ? "relative" : undefined,
        zIndex: isSelected ? 5 : undefined,
        userSelect: "none",
      }}
    >
      {children}
    </td>
  );
}

// ============================================================================
// View-Only Cell Viewer (for agent/evaluator cells)
// ============================================================================

type CellViewerProps = {
  value: unknown;
  isOpen: boolean;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLElement | null>;
};

function CellViewer({ value, isOpen, onClose, anchorRef }: CellViewerProps) {
  const [style, setStyle] = useState<React.CSSProperties>({});

  useEffect(() => {
    if (isOpen && anchorRef.current) {
      const rect = anchorRef.current.getBoundingClientRect();
      setStyle({
        position: "fixed",
        top: rect.top - 8,
        left: rect.left - 8,
        width: Math.max(rect.width + 16, 300),
        minHeight: rect.height,
        zIndex: 1000,
      });
    }
  }, [isOpen, anchorRef]);

  useEffect(() => {
    if (isOpen) {
      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === "Escape" || e.key === "Enter") {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }
      };
      document.addEventListener("keydown", handleKeyDown);
      return () => document.removeEventListener("keydown", handleKeyDown);
    }
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const displayValue =
    value === null || value === undefined
      ? ""
      : typeof value === "object"
        ? JSON.stringify(value, null, 2)
        : String(value);

  return (
    <Portal>
      <Box
        style={style}
        bg="white"
        borderRadius="md"
        boxShadow="0 0 0 2px var(--chakra-colors-gray-300), 0 4px 12px rgba(0,0,0,0.15)"
        overflow="hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <Textarea
          value={displayValue}
          readOnly
          minHeight="80px"
          resize="vertical"
          border="none"
          borderRadius="0"
          fontSize="13px"
          padding={2}
          bg="gray.50"
          _focus={{ outline: "none", boxShadow: "none" }}
        />
        <Box
          paddingX={2}
          paddingY={1}
          fontSize="10px"
          color="gray.500"
          borderTop="1px solid"
          borderColor="gray.100"
          bg="white"
        >
          Press Escape or Enter to close
        </Box>
      </Box>
    </Portal>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export function EvaluationsV3Table() {
  const {
    dataset,
    agents,
    evaluators,
    results,
    ui,
    openOverlay,
    setSelectedCell,
    setEditingCell,
    toggleRowSelection,
    selectAllRows,
    clearRowSelection,
    getRowCount,
  } = useEvaluationsV3Store((state) => ({
    dataset: state.dataset,
    agents: state.agents,
    evaluators: state.evaluators,
    results: state.results,
    ui: state.ui,
    openOverlay: state.openOverlay,
    setSelectedCell: state.setSelectedCell,
    setEditingCell: state.setEditingCell,
    toggleRowSelection: state.toggleRowSelection,
    selectAllRows: state.selectAllRows,
    clearRowSelection: state.clearRowSelection,
    getRowCount: state.getRowCount,
  }));

  const tableRef = useRef<HTMLTableElement>(null);
  const rowCount = getRowCount();
  const displayRowCount = Math.max(rowCount, 3);
  const selectedRows = ui.selectedRows;
  const allSelected = selectedRows.size === rowCount && rowCount > 0;
  const someSelected = selectedRows.size > 0 && selectedRows.size < rowCount;

  // State for viewing non-editable cells
  const [viewingCell, setViewingCell] = useState<{
    row: number;
    columnId: string;
    value: unknown;
  } | null>(null);
  const viewingCellRef = useRef<HTMLDivElement>(null);

  // Build list of ALL navigable column IDs with their types
  const allColumns = useMemo(() => {
    const cols: Array<{ id: string; type: ColumnType }> = [];

    // Checkbox column
    cols.push({ id: "__checkbox__", type: "checkbox" });

    // Dataset columns
    for (const col of dataset.columns) {
      cols.push({ id: col.id, type: "dataset" });
    }

    // Agent columns
    for (const agent of agents) {
      cols.push({ id: `agent.${agent.id}`, type: "agent" });
    }

    // Evaluator columns
    for (const evaluator of evaluators) {
      cols.push({ id: `evaluator.${evaluator.id}`, type: "evaluator" });
    }

    return cols;
  }, [dataset.columns, agents, evaluators]);

  // Keyboard navigation handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't handle if we're editing or viewing a cell
      if (ui.editingCell || viewingCell) return;

      const selectedCell = ui.selectedCell;
      if (!selectedCell) return;

      const currentColIndex = allColumns.findIndex(
        (c) => c.id === selectedCell.columnId
      );
      if (currentColIndex === -1) return;

      const currentCol = allColumns[currentColIndex];

      switch (e.key) {
        case "Enter":
        case " ":
          e.preventDefault();
          if (currentCol?.type === "checkbox") {
            // Toggle row selection
            toggleRowSelection(selectedCell.row);
          } else if (currentCol?.type === "dataset") {
            // Enter edit mode for dataset cells
            setEditingCell({
              row: selectedCell.row,
              columnId: selectedCell.columnId,
            });
          }
          // For agent/evaluator, Enter could open viewer but let's keep it simple
          break;

        case "ArrowUp":
          e.preventDefault();
          if (selectedCell.row > 0) {
            setSelectedCell({
              row: selectedCell.row - 1,
              columnId: selectedCell.columnId,
            });
          }
          break;

        case "ArrowDown":
          e.preventDefault();
          if (selectedCell.row < displayRowCount - 1) {
            setSelectedCell({
              row: selectedCell.row + 1,
              columnId: selectedCell.columnId,
            });
          }
          break;

        case "ArrowLeft":
          e.preventDefault();
          if (currentColIndex > 0) {
            setSelectedCell({
              row: selectedCell.row,
              columnId: allColumns[currentColIndex - 1]!.id,
            });
          }
          break;

        case "ArrowRight":
          e.preventDefault();
          if (currentColIndex < allColumns.length - 1) {
            setSelectedCell({
              row: selectedCell.row,
              columnId: allColumns[currentColIndex + 1]!.id,
            });
          }
          break;

        case "Tab":
          e.preventDefault();
          if (e.shiftKey) {
            if (currentColIndex > 0) {
              setSelectedCell({
                row: selectedCell.row,
                columnId: allColumns[currentColIndex - 1]!.id,
              });
            } else if (selectedCell.row > 0) {
              setSelectedCell({
                row: selectedCell.row - 1,
                columnId: allColumns[allColumns.length - 1]!.id,
              });
            }
          } else {
            if (currentColIndex < allColumns.length - 1) {
              setSelectedCell({
                row: selectedCell.row,
                columnId: allColumns[currentColIndex + 1]!.id,
              });
            } else if (selectedCell.row < displayRowCount - 1) {
              setSelectedCell({
                row: selectedCell.row + 1,
                columnId: allColumns[0]!.id,
              });
            }
          }
          break;

        case "Escape":
          e.preventDefault();
          setSelectedCell(undefined);
          break;
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [
    ui.editingCell,
    ui.selectedCell,
    viewingCell,
    allColumns,
    displayRowCount,
    setSelectedCell,
    setEditingCell,
    toggleRowSelection,
  ]);

  // Build row data from dataset records
  const rowData = useMemo((): RowData[] => {
    return Array.from({ length: displayRowCount }, (_, index) => ({
      rowIndex: index,
      dataset: Object.fromEntries(
        dataset.columns.map((col) => [
          col.id,
          dataset.records[col.id]?.[index] ?? "",
        ])
      ),
      agents: Object.fromEntries(
        agents.map((agent) => [
          agent.id,
          results.agentOutputs[agent.id]?.[index] ?? null,
        ])
      ),
      evaluators: Object.fromEntries(
        evaluators.map((evaluator) => [
          evaluator.id,
          results.evaluatorResults[evaluator.id]?.[index] ?? null,
        ])
      ),
    }));
  }, [dataset, agents, evaluators, results, displayRowCount]);

  // Build columns
  const columnHelper = createColumnHelper<RowData>();

  const columns = useMemo((): ColumnDef<RowData, unknown>[] => {
    const cols: ColumnDef<RowData, unknown>[] = [];

    // Checkbox column
    cols.push(
      columnHelper.display({
        id: "select",
        header: () => (
          <Checkbox.Root
            checked={
              allSelected ? true : someSelected ? "indeterminate" : false
            }
            onCheckedChange={() => {
              if (allSelected) {
                clearRowSelection();
              } else {
                selectAllRows(rowCount);
              }
            }}
          >
            <Checkbox.HiddenInput />
            <Checkbox.Control />
          </Checkbox.Root>
        ),
        cell: (info) => (
          <Checkbox.Root
            checked={selectedRows.has(info.row.index)}
            onCheckedChange={() => toggleRowSelection(info.row.index)}
            onClick={(e) => e.stopPropagation()}
          >
            <Checkbox.HiddenInput />
            <Checkbox.Control />
          </Checkbox.Root>
        ),
        size: 40,
        meta: {
          columnType: "checkbox" as ColumnType,
          columnId: "__checkbox__",
        },
      })
    );

    // Dataset columns
    for (const column of dataset.columns) {
      cols.push(
        columnHelper.accessor((row) => row.dataset[column.id], {
          id: `dataset.${column.id}`,
          header: () => (
            <HStack gap={1}>
              <ColumnTypeIcon type={column.type} />
              <Text fontSize="13px" fontWeight="medium">
                {column.name}
              </Text>
            </HStack>
          ),
          cell: (info) => info.getValue(),
          size: 200,
          meta: {
            columnType: "dataset" as ColumnType,
            columnId: column.id,
          },
        })
      );
    }

    // Agent columns
    for (const agent of agents) {
      cols.push(
        columnHelper.accessor((row) => row.agents[agent.id], {
          id: `agent.${agent.id}`,
          header: () => <AgentHeader agent={agent} />,
          cell: (info) => <AgentCell value={info.getValue()} />,
          size: 200,
          meta: {
            columnType: "agent" as ColumnType,
            columnId: `agent.${agent.id}`,
          },
        })
      );
    }

    // Evaluator columns
    for (const evaluator of evaluators) {
      cols.push(
        columnHelper.accessor((row) => row.evaluators[evaluator.id], {
          id: `evaluator.${evaluator.id}`,
          header: () => <EvaluatorHeader evaluator={evaluator} />,
          cell: (info) => <EvaluatorCell value={info.getValue()} />,
          size: 150,
          meta: {
            columnType: "evaluator" as ColumnType,
            columnId: `evaluator.${evaluator.id}`,
          },
        })
      );
    }

    return cols;
  }, [
    dataset.columns,
    agents,
    evaluators,
    columnHelper,
    selectedRows,
    allSelected,
    someSelected,
    rowCount,
    toggleRowSelection,
    selectAllRows,
    clearRowSelection,
  ]);

  const table = useReactTable({
    data: rowData,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  // Calculate colspan for super headers
  const datasetColSpan = 1 + dataset.columns.length;
  const agentsColSpan = Math.max(agents.length, 1);
  const evaluatorsColSpan = Math.max(evaluators.length, 1);

  // Helper to render cell with selection support
  const renderCell = useCallback(
    (cell: Cell<RowData, unknown>, rowIndex: number) => {
      const meta = cell.column.columnDef.meta as
        | { columnType: ColumnType; columnId: string }
        | undefined;

      if (!meta) {
        return (
          <td key={cell.id}>
            {flexRender(cell.column.columnDef.cell, cell.getContext())}
          </td>
        );
      }

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
        } else if (meta.columnType === "agent" || meta.columnType === "evaluator") {
          // Open viewer for agent/evaluator cells
          const value = cell.getValue();
          if (value !== null && value !== undefined) {
            setViewingCell({ row: rowIndex, columnId: meta.columnId, value });
          }
        }
      };

      // For dataset cells, use the EditableCell component
      if (meta.columnType === "dataset") {
        return (
          <td
            key={cell.id}
            onClick={handleSelect}
            onDoubleClick={handleActivate}
            style={{
              outline: isSelected
                ? "2px solid var(--chakra-colors-blue-500)"
                : "none",
              outlineOffset: "-1px",
              position: isSelected ? "relative" : undefined,
              zIndex: isSelected ? 5 : undefined,
              userSelect: "none",
            }}
          >
            <EditableCell
              value={(cell.getValue() as string) ?? ""}
              row={rowIndex}
              columnId={meta.columnId}
            />
          </td>
        );
      }

      // For other cells
      return (
        <td
          key={cell.id}
          onClick={handleSelect}
          onDoubleClick={handleActivate}
          style={{
            outline: isSelected
              ? "2px solid var(--chakra-colors-blue-500)"
              : "none",
            outlineOffset: "-1px",
            position: isSelected ? "relative" : undefined,
            zIndex: isSelected ? 5 : undefined,
            userSelect: "none",
          }}
        >
          <Box
            ref={
              viewingCell?.row === rowIndex &&
              viewingCell?.columnId === meta.columnId
                ? viewingCellRef
                : undefined
            }
          >
            {flexRender(cell.column.columnDef.cell, cell.getContext())}
          </Box>
        </td>
      );
    },
    [
      ui.selectedCell,
      viewingCell,
      setSelectedCell,
      setEditingCell,
      toggleRowSelection,
    ]
  );

  return (
    <Box
      width="full"
      minHeight="full"
      css={{
        "& table": {
          width: "100%",
          borderCollapse: "collapse",
        },
        "& th": {
          borderBottom: "1px solid var(--chakra-colors-gray-200)",
          borderRight: "1px solid var(--chakra-colors-gray-100)",
          padding: "8px 12px",
          textAlign: "left",
          backgroundColor: "white",
          fontWeight: "medium",
          fontSize: "13px",
          position: "sticky",
          top: 0,
          zIndex: 10,
        },
        "& td": {
          borderBottom: "1px solid var(--chakra-colors-gray-100)",
          borderRight: "1px solid var(--chakra-colors-gray-100)",
          padding: "8px 12px",
          fontSize: "13px",
          verticalAlign: "top",
        },
        "& tr:hover td": {
          backgroundColor: "var(--chakra-colors-gray-50)",
        },
      }}
    >
      <table ref={tableRef}>
        <thead>
          <tr>
            <SuperHeader type="dataset" colSpan={datasetColSpan} />
            <SuperHeader
              type="agents"
              colSpan={agentsColSpan}
              onAddClick={() => openOverlay("agent")}
              showWarning={agents.length === 0}
            />
            <SuperHeader
              type="evaluators"
              colSpan={evaluatorsColSpan}
              onAddClick={() => openOverlay("evaluator")}
            />
          </tr>
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <th key={header.id} style={{ width: header.getSize() }}>
                  {header.isPlaceholder
                    ? null
                    : flexRender(
                        header.column.columnDef.header,
                        header.getContext()
                      )}
                </th>
              ))}
              {agents.length === 0 && (
                <th style={{ minWidth: 150 }}>
                  <Text fontSize="xs" color="gray.400" fontStyle="italic">
                    Click "Add Agent" above
                  </Text>
                </th>
              )}
              {evaluators.length === 0 && (
                <th style={{ minWidth: 150 }}>
                  <Text fontSize="xs" color="gray.400" fontStyle="italic">
                    Click "Add Evaluator" above
                  </Text>
                </th>
              )}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr key={row.id}>
              {row.getVisibleCells().map((cell) => renderCell(cell, row.index))}
              {agents.length === 0 && <td />}
              {evaluators.length === 0 && <td />}
            </tr>
          ))}
        </tbody>
      </table>

      {/* Cell viewer for agent/evaluator cells */}
      <CellViewer
        value={viewingCell?.value}
        isOpen={!!viewingCell}
        onClose={() => setViewingCell(null)}
        anchorRef={viewingCellRef}
      />

      <SelectionToolbar
        selectedCount={selectedRows.size}
        onRun={() => console.log("Run selected:", Array.from(selectedRows))}
        onDelete={() => console.log("Delete selected:", Array.from(selectedRows))}
        onClear={clearRowSelection}
      />
    </Box>
  );
}

// ============================================================================
// Cell Components
// ============================================================================

function AgentHeader({ agent }: { agent: AgentConfig }) {
  const { openOverlay } = useEvaluationsV3Store((state) => ({
    openOverlay: state.openOverlay,
  }));

  return (
    <HStack
      gap={2}
      cursor="pointer"
      onClick={() => openOverlay("agent", agent.id)}
      _hover={{ color: "green.600" }}
    >
      <ColorfulBlockIcon
        color={agent.type === "llm" ? "green.400" : "#3E5A60"}
        size="xs"
        icon={agent.type === "llm" ? <LLMIcon /> : <Code size={12} />}
      />
      <Text fontSize="13px" fontWeight="medium">
        {agent.name}
      </Text>
    </HStack>
  );
}

function AgentCell({ value }: { value: unknown }) {
  if (value === null || value === undefined) return null;

  const displayValue =
    typeof value === "object" ? JSON.stringify(value) : String(value);

  return (
    <Text fontSize="13px" lineClamp={3}>
      {displayValue}
    </Text>
  );
}

function EvaluatorHeader({ evaluator }: { evaluator: EvaluatorConfig }) {
  const { openOverlay } = useEvaluationsV3Store((state) => ({
    openOverlay: state.openOverlay,
  }));

  return (
    <HStack
      gap={2}
      cursor="pointer"
      onClick={() => openOverlay("evaluator", evaluator.id)}
      _hover={{ color: "green.600" }}
    >
      <ColorfulBlockIcon color="#5FD15D" size="xs" icon={<Check size={12} />} />
      <Text fontSize="13px" fontWeight="medium">
        {evaluator.name}
      </Text>
    </HStack>
  );
}

function EvaluatorCell({ value }: { value: unknown }) {
  if (value === null || value === undefined) return null;

  if (typeof value === "boolean") {
    return (
      <Text
        fontSize="13px"
        color={value ? "green.600" : "red.600"}
        fontWeight="medium"
      >
        {value ? "✓ Passed" : "✗ Failed"}
      </Text>
    );
  }

  if (typeof value === "number") {
    return (
      <Text fontSize="13px" fontWeight="medium">
        {value.toFixed(2)}
      </Text>
    );
  }

  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if ("passed" in obj) {
      return (
        <Text
          fontSize="13px"
          color={obj.passed ? "green.600" : "red.600"}
          fontWeight="medium"
        >
          {obj.passed ? "✓ Passed" : "✗ Failed"}
        </Text>
      );
    }
    if ("score" in obj && typeof obj.score === "number") {
      return (
        <Text fontSize="13px" fontWeight="medium">
          {obj.score.toFixed(2)}
        </Text>
      );
    }
  }

  return (
    <Text fontSize="13px" lineClamp={2}>
      {JSON.stringify(value)}
    </Text>
  );
}
