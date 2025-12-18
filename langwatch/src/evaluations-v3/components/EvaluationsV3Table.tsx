import {
  Box,
  Button,
  Checkbox,
  HStack,
  Portal,
  Text,
  Textarea,
  VStack,
} from "@chakra-ui/react";
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
  ChevronDown,
  ChevronUp,
  Code,
  Database,
  Hash,
  List,
  MessageSquare,
  Plus,
  Type,
  X,
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
  agents: Record<string, { output: unknown; evaluators: Record<string, unknown> }>;
};

type SuperHeaderType = "dataset" | "agents";

type ColumnType = "checkbox" | "dataset" | "agent";

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
            Add Agent
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
// Evaluator Chip Component
// ============================================================================

type EvaluatorChipProps = {
  evaluator: EvaluatorConfig;
  result: unknown;
  agentId: string;
  row: number;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onEdit: () => void;
};

function EvaluatorChip({
  evaluator,
  result,
  isExpanded,
  onToggleExpand,
  onEdit,
}: EvaluatorChipProps) {
  // Determine pass/fail status from result
  let status: "pending" | "passed" | "failed" | "error" = "pending";
  let score: number | undefined;

  if (result !== null && result !== undefined) {
    if (typeof result === "boolean") {
      status = result ? "passed" : "failed";
    } else if (typeof result === "object") {
      const obj = result as Record<string, unknown>;
      if ("passed" in obj) {
        status = obj.passed ? "passed" : "failed";
      }
      if ("score" in obj && typeof obj.score === "number") {
        score = obj.score;
      }
      if ("error" in obj) {
        status = "error";
      }
    }
  }

  const statusColors = {
    pending: { bg: "gray.100", color: "gray.600", icon: null },
    passed: { bg: "green.100", color: "green.700", icon: <Check size={10} /> },
    failed: { bg: "red.100", color: "red.700", icon: <X size={10} /> },
    error: { bg: "orange.100", color: "orange.700", icon: <X size={10} /> },
  };

  const statusConfig = statusColors[status];

  return (
    <Box>
      <HStack
        as="button"
        onClick={onToggleExpand}
        bg={statusConfig.bg}
        color={statusConfig.color}
        paddingX={2}
        paddingY={1}
        borderRadius="md"
        fontSize="11px"
        fontWeight="medium"
        gap={1}
        _hover={{ opacity: 0.8 }}
        cursor="pointer"
      >
        {statusConfig.icon}
        <Text>{evaluator.name}</Text>
        {score !== undefined && <Text>({score.toFixed(2)})</Text>}
        {isExpanded ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
      </HStack>

      {isExpanded && (
        <Box
          marginTop={2}
          padding={2}
          bg="gray.50"
          borderRadius="md"
          fontSize="12px"
        >
          <VStack align="stretch" gap={1}>
            <Text fontWeight="medium">Result:</Text>
            <Text color="gray.600" whiteSpace="pre-wrap">
              {result === null || result === undefined
                ? "No result yet"
                : typeof result === "object"
                  ? JSON.stringify(result, null, 2)
                  : String(result)}
            </Text>
            <Button
              size="xs"
              variant="ghost"
              onClick={(e) => {
                e.stopPropagation();
                onEdit();
              }}
              marginTop={1}
            >
              Edit Configuration
            </Button>
          </VStack>
        </Box>
      )}
    </Box>
  );
}

// ============================================================================
// Agent Cell Content Component
// ============================================================================

type AgentCellContentProps = {
  agent: AgentConfig;
  output: unknown;
  evaluatorResults: Record<string, unknown>;
  row: number;
  evaluatorsMap: Map<string, EvaluatorConfig>;
};

function AgentCellContent({
  agent,
  output,
  evaluatorResults,
  row,
  evaluatorsMap,
}: AgentCellContentProps) {
  const { ui, openOverlay, setExpandedEvaluator } = useEvaluationsV3Store(
    (state) => ({
      ui: state.ui,
      openOverlay: state.openOverlay,
      setExpandedEvaluator: state.setExpandedEvaluator,
    })
  );

  const displayOutput =
    output === null || output === undefined
      ? ""
      : typeof output === "object"
        ? JSON.stringify(output)
        : String(output);

  // Get evaluator configs for this agent's evaluatorIds
  const agentEvaluators = agent.evaluatorIds
    .map((id) => evaluatorsMap.get(id))
    .filter((e): e is EvaluatorConfig => e !== undefined);

  return (
    <VStack align="stretch" gap={2}>
      {/* Agent output */}
      <Text fontSize="13px" lineClamp={3}>
        {displayOutput || <Text as="span" color="gray.400">No output yet</Text>}
      </Text>

      {/* Evaluator chips */}
      {agentEvaluators.length > 0 && (
        <HStack flexWrap="wrap" gap={1}>
          {agentEvaluators.map((evaluator) => {
            const isExpanded =
              ui.expandedEvaluator?.agentId === agent.id &&
              ui.expandedEvaluator?.evaluatorId === evaluator.id &&
              ui.expandedEvaluator?.row === row;

            return (
              <EvaluatorChip
                key={evaluator.id}
                evaluator={evaluator}
                result={evaluatorResults[evaluator.id]}
                agentId={agent.id}
                row={row}
                isExpanded={isExpanded}
                onToggleExpand={() => {
                  if (isExpanded) {
                    setExpandedEvaluator(undefined);
                  } else {
                    setExpandedEvaluator({
                      agentId: agent.id,
                      evaluatorId: evaluator.id,
                      row,
                    });
                  }
                }}
                onEdit={() => openOverlay("evaluator", agent.id, evaluator.id)}
              />
            );
          })}
        </HStack>
      )}

      {/* Add evaluator button */}
      <Button
        size="xs"
        variant="ghost"
        color="gray.500"
        onClick={(e) => {
          e.stopPropagation();
          openOverlay("evaluator", agent.id);
        }}
        justifyContent="flex-start"
        paddingX={1}
      >
        <Plus size={10} />
        <Text marginLeft={1}>Add evaluator</Text>
      </Button>
    </VStack>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export function EvaluationsV3Table() {
  const {
    dataset,
    evaluators,
    agents,
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
    evaluators: state.evaluators,
    agents: state.agents,
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

  // Create a map of evaluator IDs to evaluator configs for quick lookup
  const evaluatorsMap = useMemo(
    () => new Map(evaluators.map((e) => [e.id, e])),
    [evaluators]
  );

  const tableRef = useRef<HTMLTableElement>(null);
  const rowCount = getRowCount();
  const displayRowCount = Math.max(rowCount, 3);
  const selectedRows = ui.selectedRows;
  const allSelected = selectedRows.size === rowCount && rowCount > 0;
  const someSelected = selectedRows.size > 0 && selectedRows.size < rowCount;

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

    return cols;
  }, [dataset.columns, agents]);

  // Keyboard navigation handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't handle if we're editing a cell
      if (ui.editingCell) return;

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
            toggleRowSelection(selectedCell.row);
          } else if (currentCol?.type === "dataset") {
            setEditingCell({
              row: selectedCell.row,
              columnId: selectedCell.columnId,
            });
          }
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
          {
            output: results.agentOutputs[agent.id]?.[index] ?? null,
            evaluators: Object.fromEntries(
              agent.evaluatorIds.map((evaluatorId) => [
                evaluatorId,
                results.evaluatorResults[agent.id]?.[evaluatorId]?.[index] ?? null,
              ])
            ),
          },
        ])
      ),
    }));
  }, [dataset, agents, results, displayRowCount]);

  // Build columns
  const columnHelper = createColumnHelper<RowData>();

  const columns = useMemo(() => {
    const cols: ColumnDef<RowData>[] = [];

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
        }) as ColumnDef<RowData>
      );
    }

    // Agent columns (each agent is ONE column, with output + evaluators inside)
    for (const agent of agents) {
      cols.push(
        columnHelper.accessor((row) => row.agents[agent.id], {
          id: `agent.${agent.id}`,
          header: () => <AgentHeader agent={agent} />,
          cell: (info) => {
            const data = info.getValue() as {
              output: unknown;
              evaluators: Record<string, unknown>;
            };
            return (
              <AgentCellContent
                agent={agent}
                output={data?.output}
                evaluatorResults={data?.evaluators ?? {}}
                row={info.row.index}
                evaluatorsMap={evaluatorsMap}
              />
            );
          },
          size: 280,
          meta: {
            columnType: "agent" as ColumnType,
            columnId: `agent.${agent.id}`,
          },
        }) as ColumnDef<RowData>
      );
    }

    return cols;
  }, [
    dataset.columns,
    agents,
    evaluatorsMap,
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
            verticalAlign: "top",
          }}
        >
          {flexRender(cell.column.columnDef.cell, cell.getContext())}
        </td>
      );
    },
    [ui.selectedCell, setSelectedCell, setEditingCell, toggleRowSelection]
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
                <th style={{ minWidth: 200 }}>
                  <Text fontSize="xs" color="gray.400" fontStyle="italic">
                    Click "Add Agent" above
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
            </tr>
          ))}
        </tbody>
      </table>

      <SelectionToolbar
        selectedCount={selectedRows.size}
        onRun={() => console.log("Run selected:", Array.from(selectedRows))}
        onDelete={() =>
          console.log("Delete selected:", Array.from(selectedRows))
        }
        onClear={clearRowSelection}
      />
    </Box>
  );
}

// ============================================================================
// Agent Header Component
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
