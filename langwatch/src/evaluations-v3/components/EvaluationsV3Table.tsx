import { Box, Button, Checkbox, HStack, Text } from "@chakra-ui/react";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type Cell,
} from "@tanstack/react-table";
import { useCallback, useMemo } from "react";
import {
  AlertCircle,
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
            color={showWarning ? "orange.500" : "gray.500"}
          >
            <Plus size={12} />
            Add {type === "agents" ? "Agent" : "Evaluator"}
            {showWarning && <AlertCircle size={12} style={{ marginLeft: 4 }} />}
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
// Dataset Cell TD Wrapper
// ============================================================================

type DatasetCellTdProps = {
  cell: Cell<RowData, unknown>;
  row: number;
  columnId: string;
  value: string;
};

function DatasetCellTd({ cell, row, columnId, value }: DatasetCellTdProps) {
  const { ui, setSelectedCell, setEditingCell } = useEvaluationsV3Store(
    (state) => ({
      ui: state.ui,
      setSelectedCell: state.setSelectedCell,
      setEditingCell: state.setEditingCell,
    })
  );

  const isSelected =
    ui.selectedCell?.row === row && ui.selectedCell?.columnId === columnId;

  const handleClick = useCallback(() => {
    setSelectedCell({ row, columnId });
  }, [row, columnId, setSelectedCell]);

  const handleDoubleClick = useCallback(() => {
    setSelectedCell({ row, columnId });
    setEditingCell({ row, columnId });
  }, [row, columnId, setSelectedCell, setEditingCell]);

  return (
    <td
      key={cell.id}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      style={{
        outline: isSelected ? "2px solid var(--chakra-colors-blue-500)" : "none",
        outlineOffset: "-1px",
        position: isSelected ? "relative" : undefined,
        zIndex: isSelected ? 5 : undefined,
        userSelect: "none",
      }}
    >
      <EditableCell value={value} row={row} columnId={columnId} />
    </td>
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
    toggleRowSelection: state.toggleRowSelection,
    selectAllRows: state.selectAllRows,
    clearRowSelection: state.clearRowSelection,
    getRowCount: state.getRowCount,
  }));

  const rowCount = getRowCount();
  const selectedRows = ui.selectedRows;
  const allSelected = selectedRows.size === rowCount && rowCount > 0;
  const someSelected = selectedRows.size > 0 && selectedRows.size < rowCount;

  // Build row data from dataset records
  const rowData = useMemo((): RowData[] => {
    const count = Math.max(rowCount, 3);

    return Array.from({ length: count }, (_, index) => ({
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
  }, [dataset, agents, evaluators, results, rowCount]);

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
            checked={allSelected ? true : someSelected ? "indeterminate" : false}
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
          >
            <Checkbox.HiddenInput />
            <Checkbox.Control />
          </Checkbox.Root>
        ),
        size: 40,
        meta: { superHeader: "dataset" as SuperHeaderType, isDatasetCell: false },
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
            superHeader: "dataset" as SuperHeaderType,
            isDatasetCell: true,
            datasetColumnId: column.id,
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
          meta: { superHeader: "agents" as SuperHeaderType, isDatasetCell: false },
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
          meta: { superHeader: "evaluators" as SuperHeaderType, isDatasetCell: false },
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
  const datasetColSpan = 1 + dataset.columns.length; // checkbox + columns
  const agentsColSpan = Math.max(agents.length, 1);
  const evaluatorsColSpan = Math.max(evaluators.length, 1);

  // Helper to render cell - uses custom td for dataset cells
  const renderCell = (cell: Cell<RowData, unknown>, rowIndex: number) => {
    const meta = cell.column.columnDef.meta as {
      isDatasetCell?: boolean;
      datasetColumnId?: string;
    } | undefined;

    if (meta?.isDatasetCell && meta.datasetColumnId) {
      return (
        <DatasetCellTd
          key={cell.id}
          cell={cell}
          row={rowIndex}
          columnId={meta.datasetColumnId}
          value={(cell.getValue() as string) ?? ""}
        />
      );
    }

    return (
      <td key={cell.id}>
        {flexRender(cell.column.columnDef.cell, cell.getContext())}
      </td>
    );
  };

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
      <table>
        <thead>
          {/* Super headers row */}
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
          {/* Column headers row */}
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
              {/* Placeholder cells for Add buttons if no agents/evaluators */}
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
              {/* Placeholder cells for empty agents/evaluators */}
              {agents.length === 0 && <td />}
              {evaluators.length === 0 && <td />}
            </tr>
          ))}
        </tbody>
      </table>

      {/* Selection toolbar */}
      <SelectionToolbar
        selectedCount={selectedRows.size}
        onRun={() => {
          console.log("Run selected:", Array.from(selectedRows));
        }}
        onDelete={() => {
          console.log("Delete selected:", Array.from(selectedRows));
        }}
        onClear={clearRowSelection}
      />
    </Box>
  );
}

// ============================================================================
// Cell Components
// ============================================================================

type AgentHeaderProps = {
  agent: AgentConfig;
};

function AgentHeader({ agent }: AgentHeaderProps) {
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

type AgentCellProps = {
  value: unknown;
};

function AgentCell({ value }: AgentCellProps) {
  if (value === null || value === undefined) {
    return null;
  }

  const displayValue =
    typeof value === "object" ? JSON.stringify(value) : String(value);

  return (
    <Text fontSize="13px" lineClamp={3}>
      {displayValue}
    </Text>
  );
}

type EvaluatorHeaderProps = {
  evaluator: EvaluatorConfig;
};

function EvaluatorHeader({ evaluator }: EvaluatorHeaderProps) {
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

type EvaluatorCellProps = {
  value: unknown;
};

function EvaluatorCell({ value }: EvaluatorCellProps) {
  if (value === null || value === undefined) {
    return null;
  }

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
