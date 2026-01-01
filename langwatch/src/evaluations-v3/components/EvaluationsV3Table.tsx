import { Box, HStack, Text } from "@chakra-ui/react";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type ColumnSizingState,
} from "@tanstack/react-table";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";

import { AddOrEditDatasetDrawer } from "~/components/AddOrEditDatasetDrawer";
import { useDrawer, setFlowCallbacks } from "~/hooks/useDrawer";
import type { TypedAgent } from "~/server/agents/agent.repository";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { useDatasetSync } from "../hooks/useDatasetSync";
import { useEvaluationsV3Store } from "../hooks/useEvaluationsV3Store";
import { useDatasetSelectionLoader } from "../hooks/useSavedDatasetLoader";
import { useTableKeyboardNavigation } from "../hooks/useTableKeyboardNavigation";
import { convertInlineToRowRecords } from "../utils/datasetConversion";
import {
  convertToUIMapping,
  convertFromUIMapping,
} from "../utils/fieldMappingConverters";
import type {
  RunnerConfig,
  DatasetColumn,
  DatasetReference,
  SavedRecord,
  FieldMapping,
  EvaluatorConfig,
  TableRowData,
  TableMeta,
} from "../types";
import {
  datasetColumnTypeToFieldType,
  type AvailableSource,
  type FieldMapping as UIFieldMapping,
} from "~/components/variables";
import type { DatasetColumnType } from "~/server/datasets/types";

import { TableCell, type ColumnType } from "./DatasetSection/TableCell";
import { ColumnTypeIcon, SuperHeader } from "./TableUI";
import { SelectionToolbar } from "./SelectionToolbar";
import {
  CheckboxHeaderFromMeta,
  CheckboxCellFromMeta,
  RunnerHeaderFromMeta,
  RunnerCellFromMeta,
} from "./TableMetaWrappers";

// Types are imported from ../types (TableRowData, TableMeta)
// Meta wrappers are imported from ./TableMetaWrappers

// ============================================================================
// Main Component
// ============================================================================

type EvaluationsV3TableProps = {
  isLoadingExperiment?: boolean;
  isLoadingDatasets?: boolean;
};

export function EvaluationsV3Table({
  isLoadingExperiment = false,
  isLoadingDatasets = false,
}: EvaluationsV3TableProps) {
  const { openDrawer, closeDrawer } = useDrawer();
  const { project } = useOrganizationTeamProject();

  // Sync saved dataset changes to DB
  useDatasetSync();

  const {
    datasets,
    activeDatasetId,
    evaluators,
    runners,
    results,
    ui,
    openOverlay,
    setSelectedCell,
    setEditingCell,
    toggleRowSelection,
    selectAllRows,
    clearRowSelection,
    deleteSelectedRows,
    getRowCount,
    addDataset,
    setActiveDataset,
    removeDataset,
    updateDataset,
    setColumnWidths,
    toggleColumnVisibility,
    addRunner,
    updateRunner,
    removeRunner,
    setRunnerMapping,
    addEvaluator,
  } = useEvaluationsV3Store(
    useShallow((state) => ({
      datasets: state.datasets,
      activeDatasetId: state.activeDatasetId,
      evaluators: state.evaluators,
      runners: state.runners,
      results: state.results,
      // Only subscribe to specific UI properties we need (not the entire ui object)
      ui: {
        selectedRows: state.ui.selectedRows,
        editingCell: state.ui.editingCell,
        selectedCell: state.ui.selectedCell,
        columnWidths: state.ui.columnWidths,
        hiddenColumns: state.ui.hiddenColumns,
      },
      // Actions (stable references)
      openOverlay: state.openOverlay,
      setSelectedCell: state.setSelectedCell,
      setEditingCell: state.setEditingCell,
      toggleRowSelection: state.toggleRowSelection,
      selectAllRows: state.selectAllRows,
      clearRowSelection: state.clearRowSelection,
      deleteSelectedRows: state.deleteSelectedRows,
      getRowCount: state.getRowCount,
      addDataset: state.addDataset,
      setActiveDataset: state.setActiveDataset,
      removeDataset: state.removeDataset,
      updateDataset: state.updateDataset,
      setColumnWidths: state.setColumnWidths,
      toggleColumnVisibility: state.toggleColumnVisibility,
      addRunner: state.addRunner,
      updateRunner: state.updateRunner,
      removeRunner: state.removeRunner,
      setRunnerMapping: state.setRunnerMapping,
      addEvaluator: state.addEvaluator,
    })),
  );

  // Load saved datasets when selected from drawer
  const { loadSavedDataset } = useDatasetSelectionLoader({
    projectId: project?.id,
    addDataset,
    setActiveDataset,
  });

  // Get the active dataset
  const activeDataset = useMemo(
    () => datasets.find((d) => d.id === activeDatasetId),
    [datasets, activeDatasetId],
  );

  // State for AddOrEditDatasetDrawer (for Save as dataset)
  const [saveAsDatasetDrawerOpen, setSaveAsDatasetDrawerOpen] = useState(false);
  const [datasetToSave, setDatasetToSave] = useState<
    | {
        name: string;
        columnTypes: { name: string; type: DatasetColumnType }[];
        datasetRecords: Array<{ id: string } & Record<string, string>>;
      }
    | undefined
  >(undefined);

  // State for editing dataset columns
  const [editDatasetDrawerOpen, setEditDatasetDrawerOpen] = useState(false);

  // Handler for when a saved agent is selected from the drawer
  const handleSelectSavedAgent = useCallback(
    (savedAgent: TypedAgent) => {
      const config = savedAgent.config as Record<string, unknown>;

      // Convert TypedAgent to RunnerConfig format (agent type)
      // Agent type and workflow ID are fetched at runtime via dbAgentId when needed
      const runnerConfig: RunnerConfig = {
        id: `runner_${Date.now()}`, // Generate unique ID for the workbench
        type: "agent", // This is a runner of type "agent" (code/workflow)
        name: savedAgent.name,
        dbAgentId: savedAgent.id, // Reference to the database agent
        inputs: (config.inputs as RunnerConfig["inputs"]) ?? [
          { identifier: "input", type: "str" },
        ],
        outputs: (config.outputs as RunnerConfig["outputs"]) ?? [
          { identifier: "output", type: "str" },
        ],
        mappings: {},
        evaluatorIds: [],
      };
      addRunner(runnerConfig);
      closeDrawer();
    },
    [addRunner, closeDrawer],
  );

  // Handler for when a prompt is selected from the drawer
  const handleSelectPrompt = useCallback(
    (prompt: { id: string; name: string; versionId?: string }) => {
      // Convert prompt to RunnerConfig format (prompt type)
      const runnerConfig: RunnerConfig = {
        id: `runner_${Date.now()}`, // Generate unique ID for the workbench
        type: "prompt",
        name: prompt.name,
        promptId: prompt.id,
        promptVersionId: prompt.versionId,
        inputs: [{ identifier: "input", type: "str" }],
        outputs: [{ identifier: "output", type: "str" }],
        mappings: {},
        evaluatorIds: [],
      };
      addRunner(runnerConfig);
      closeDrawer();
    },
    [addRunner, closeDrawer],
  );

  // Handler for opening the evaluator selector for a specific runner
  const handleAddEvaluatorForRunner = useCallback(
    (runnerId: string) => {
      openDrawer("evaluatorList", { urlParams: { runnerId } });
    },
    [openDrawer],
  );

  // tRPC utils for fetching agent data
  const trpcUtils = api.useContext();

  // Build available sources from datasets for variable mapping
  const buildAvailableSources = useCallback((): AvailableSource[] => {
    return datasets.map((dataset) => ({
      id: dataset.id,
      name: dataset.name,
      type: "dataset" as const,
      fields: dataset.columns.map((col) => ({
        name: col.name,
        type: datasetColumnTypeToFieldType(col.type),
      })),
    }));
  }, [datasets]);

  // Helper to check if a source ID refers to a dataset
  const isDatasetSource = useCallback(
    (sourceId: string) => datasets.some((d) => d.id === sourceId),
    [datasets],
  );

  // Handler for editing a runner (clicking on the header)
  const handleEditRunner = useCallback(
    async (runner: RunnerConfig) => {
      if (runner.type === "prompt") {
        // Build available sources for variable mapping
        const availableSources = buildAvailableSources();

        // Convert runner mappings to UI format
        const uiMappings: Record<string, UIFieldMapping> = {};
        for (const [key, mapping] of Object.entries(runner.mappings)) {
          uiMappings[key] = convertToUIMapping(mapping);
        }

        // Set flow callbacks for the prompt editor
        // onLocalConfigChange: persists local changes to the store (for orange dot indicator)
        // onSave: updates runner when prompt is published
        // onInputMappingsChange: updates runner mappings when variable mappings change
        setFlowCallbacks("promptEditor", {
          onLocalConfigChange: (localConfig) => {
            updateRunner(runner.id, { localPromptConfig: localConfig });
          },
          onSave: (savedPrompt) => {
            updateRunner(runner.id, {
              name: savedPrompt.name,
              promptId: savedPrompt.id,
              localPromptConfig: undefined, // Clear local config on save
            });
          },
          onInputMappingsChange: (
            identifier: string,
            mapping: UIFieldMapping | undefined,
          ) => {
            if (mapping) {
              setRunnerMapping(
                runner.id,
                identifier,
                convertFromUIMapping(mapping, isDatasetSource),
              );
            } else {
              // Remove the mapping by updating runner without this key
              const currentRunner = useEvaluationsV3Store
                .getState()
                .runners.find((r) => r.id === runner.id);
              if (currentRunner) {
                const newMappings = { ...currentRunner.mappings };
                delete newMappings[identifier];
                updateRunner(runner.id, { mappings: newMappings });
              }
            }
          },
        });
        // Pass initialLocalConfig and available sources as complex props
        const initialLocalConfig = runner.localPromptConfig;
        openDrawer("promptEditor", {
          promptId: runner.promptId,
          initialLocalConfig,
          availableSources,
          inputMappings: uiMappings,
          urlParams: { runnerId: runner.id },
        });
      } else if (runner.type === "agent" && runner.dbAgentId) {
        // Fetch the agent to determine its type
        try {
          const agent = await trpcUtils.agents.getById.fetch({
            projectId: project?.id ?? "",
            id: runner.dbAgentId,
          });

          if (agent?.type === "workflow") {
            // Open workflow in new tab
            const config = agent.config as Record<string, unknown>;
            const workflowId = config.workflowId as string | undefined;
            if (workflowId) {
              const workflowUrl = `/${project?.slug}/studio/${workflowId}`;
              window.open(workflowUrl, "_blank");
            }
          } else {
            // Code agent - open code editor drawer
            openDrawer("agentCodeEditor", {
              urlParams: {
                runnerId: runner.id,
                agentId: runner.dbAgentId ?? "",
              },
            });
          }
        } catch (error) {
          console.error("Failed to fetch agent:", error);
        }
      }
    },
    [project?.id, project?.slug, trpcUtils.agents.getById, openDrawer],
  );

  // Handler for removing a runner from the workbench
  const handleRemoveRunner = useCallback(
    (runnerId: string) => {
      removeRunner(runnerId);
    },
    [removeRunner],
  );

  // Dataset handlers for drawer integration
  const datasetHandlers = useMemo(
    () => ({
      onSelectExisting: () => {
        openDrawer("selectDataset", {
          onSelect: (dataset: {
            datasetId: string;
            name: string;
            columnTypes: { name: string; type: DatasetColumnType }[];
          }) => {
            // Trigger loading of saved dataset records
            loadSavedDataset({
              datasetId: dataset.datasetId,
              name: dataset.name,
              columnTypes: dataset.columnTypes,
            });
          },
        });
      },
      onUploadCSV: () => {
        openDrawer("uploadCSV", {
          onSuccess: (params: {
            datasetId: string;
            name: string;
            columnTypes: { name: string; type: DatasetColumnType }[];
          }) => {
            // Trigger loading of uploaded dataset records
            loadSavedDataset({
              datasetId: params.datasetId,
              name: params.name,
              columnTypes: params.columnTypes,
            });
          },
        });
      },
      onEditDataset: () => {
        setEditDatasetDrawerOpen(true);
      },
      onSaveAsDataset: (dataset: DatasetReference) => {
        if (dataset.type !== "inline" || !dataset.inline) return;

        // Convert inline dataset to row-based format, filtering empty rows
        const columns = dataset.inline.columns;
        const datasetRecords = convertInlineToRowRecords(
          columns,
          dataset.inline.records,
        );

        setDatasetToSave({
          name: dataset.name,
          columnTypes: columns.map((col) => ({
            name: col.name,
            type: col.type as DatasetColumnType,
          })),
          datasetRecords,
        });
        setSaveAsDatasetDrawerOpen(true);
      },
    }),
    [openDrawer, loadSavedDataset],
  );

  // Create a map of evaluator IDs to evaluator configs for quick lookup
  const evaluatorsMap = useMemo(
    () => new Map(evaluators.map((e) => [e.id, e])),
    [evaluators],
  );

  const tableRef = useRef<HTMLTableElement>(null);

  // Clear cell selection when clicking outside the table rows
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      // Only clear if there's a selected cell
      if (!ui.selectedCell) return;

      // Check if click was inside the actual table element (rows)
      if (tableRef.current?.contains(e.target as Node)) return;

      // Clear the selection
      setSelectedCell(undefined);
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [ui.selectedCell, setSelectedCell]);

  const rowCount = getRowCount(activeDatasetId);
  // Always show at least 3 rows, and always include 1 extra empty row at the end (Excel-like behavior)
  const displayRowCount = Math.max(rowCount + 1, 3);
  const selectedRows = ui.selectedRows;
  const allSelected = selectedRows.size === rowCount && rowCount > 0;
  const someSelected = selectedRows.size > 0 && selectedRows.size < rowCount;

  // Get columns from active dataset, filtering out hidden columns
  const allDatasetColumns = activeDataset?.columns ?? [];
  const datasetColumns = useMemo(
    () => allDatasetColumns.filter((col) => !ui.hiddenColumns.has(col.name)),
    [allDatasetColumns, ui.hiddenColumns],
  );

  // Keyboard navigation hook - handles arrow keys, Tab, Enter, Escape
  useTableKeyboardNavigation({
    datasetColumns,
    runners,
    displayRowCount,
    editingCell: ui.editingCell,
    selectedCell: ui.selectedCell,
    setSelectedCell,
    setEditingCell,
    toggleRowSelection,
  });

  // Get getCellValue from store
  const { getCellValue } = useEvaluationsV3Store((state) => ({
    getCellValue: state.getCellValue,
  }));

  // Build row data from active dataset records (works for both inline and saved)
  // Note: We include activeDataset in dependencies to ensure re-render when cell values change
  const rowData = useMemo((): TableRowData[] => {
    return Array.from({ length: displayRowCount }, (_, index) => ({
      rowIndex: index,
      dataset: Object.fromEntries(
        datasetColumns.map((col) => [
          col.id,
          getCellValue(activeDatasetId, index, col.id),
        ]),
      ),
      runners: Object.fromEntries(
        runners.map((runner) => [
          runner.id,
          {
            output: results.runnerOutputs[runner.id]?.[index] ?? null,
            evaluators: Object.fromEntries(
              runner.evaluatorIds.map((evaluatorId) => [
                evaluatorId,
                results.evaluatorResults[runner.id]?.[evaluatorId]?.[index] ??
                  null,
              ]),
            ),
          },
        ]),
      ),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- activeDataset triggers re-render when data changes
  }, [
    activeDatasetId,
    activeDataset,
    datasetColumns,
    runners,
    results,
    displayRowCount,
    getCellValue,
  ]);

  // Build columns - columnHelper is stable (useMemo to prevent recreating)
  const columnHelper = useMemo(() => createColumnHelper<TableRowData>(), []);

  // Extract runner IDs for stable column structure
  // Only recreate when the actual IDs change, not when runner data changes
  const runnerIdsKey = runners.map((r) => r.id).join(",");
  const runnerIds = useMemo(() => runners.map((r) => r.id), [runnerIdsKey]);

  // Similarly stabilize dataset column IDs
  const datasetColumnIdsKey = datasetColumns.map((c) => c.id).join(",");
  const stableDatasetColumns = useMemo(() => datasetColumns, [datasetColumnIdsKey]);

  // Build table meta for passing dynamic data to headers/cells
  // This allows column definitions to stay stable while data changes
  const runnersMap = useMemo(
    () => new Map(runners.map((r) => [r.id, r])),
    [runners]
  );

  const tableMeta: TableMeta = useMemo(
    () => ({
      // Runner data
      runners,
      runnersMap,
      evaluatorsMap,
      handleEditRunner,
      handleRemoveRunner,
      handleAddEvaluatorForRunner,
      // Selection data
      selectedRows,
      allSelected,
      someSelected,
      rowCount,
      toggleRowSelection,
      selectAllRows,
      clearRowSelection,
    }),
    [
      runners,
      runnersMap,
      evaluatorsMap,
      handleEditRunner,
      handleRemoveRunner,
      handleAddEvaluatorForRunner,
      selectedRows,
      allSelected,
      someSelected,
      rowCount,
      toggleRowSelection,
      selectAllRows,
      clearRowSelection,
    ]
  );

  const columns = useMemo(() => {
    const cols: ColumnDef<TableRowData>[] = [];

    // Checkbox column - reads from meta to keep column definition stable
    cols.push(
      columnHelper.display({
        id: "select",
        header: (context) => <CheckboxHeaderFromMeta context={context} />,
        cell: (info) => (
          <CheckboxCellFromMeta
            rowIndex={info.row.index}
            tableMeta={info.table.options.meta as TableMeta | undefined}
          />
        ),
        size: 40,
        meta: {
          columnType: "checkbox" as ColumnType,
          columnId: "__checkbox__",
        },
      }),
    );

    // Dataset columns from active dataset
    for (const column of stableDatasetColumns) {
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
            dataType: column.type,
          },
        }) as ColumnDef<TableRowData>,
      );
    }

    // Runner columns - use IDs only for stable column structure
    // Headers/cells read current data from table meta
    for (const runnerId of runnerIds) {
      cols.push(
        columnHelper.accessor((row) => row.runners[runnerId], {
          id: `runner.${runnerId}`,
          header: (context) => (
            <RunnerHeaderFromMeta runnerId={runnerId} context={context} />
          ),
          cell: (info) => {
            const data = info.getValue() as {
              output: unknown;
              evaluators: Record<string, unknown>;
            };
            return (
              <RunnerCellFromMeta
                runnerId={runnerId}
                data={data}
                rowIndex={info.row.index}
                tableMeta={info.table.options.meta as TableMeta | undefined}
              />
            );
          },
          size: 280,
          minSize: 200,
          meta: {
            columnType: "runner" as ColumnType,
            columnId: `runner.${runnerId}`,
          },
        }) as ColumnDef<TableRowData>,
      );
    }

    return cols;
  }, [
    // ONLY structural dependencies - columns should almost never change
    // All dynamic data goes through tableMeta
    runnerIds,
    stableDatasetColumns,
    columnHelper,
  ]);

  // Column sizing state - initialize from store
  const [columnSizing, setColumnSizing] = useState<ColumnSizingState>(
    () => ui.columnWidths,
  );

  // Sync column sizing changes to store (debounced to avoid excessive updates)
  const syncTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const handleColumnSizingChange = useCallback(
    (
      updater:
        | ColumnSizingState
        | ((prev: ColumnSizingState) => ColumnSizingState),
    ) => {
      setColumnSizing((prev) => {
        const newSizing =
          typeof updater === "function" ? updater(prev) : updater;
        // Debounce sync to store
        if (syncTimeoutRef.current) {
          clearTimeout(syncTimeoutRef.current);
        }
        syncTimeoutRef.current = setTimeout(() => {
          setColumnWidths(newSizing);
        }, 100);
        return newSizing;
      });
    },
    [setColumnWidths],
  );

  const table = useReactTable({
    data: rowData,
    columns,
    getCoreRowModel: getCoreRowModel(),
    columnResizeMode: "onChange",
    enableColumnResizing: true,
    state: {
      columnSizing,
    },
    onColumnSizingChange: handleColumnSizingChange,
    meta: tableMeta,
  });

  // Calculate colspan for super headers
  const datasetColSpan = 1 + datasetColumns.length;
  // +1 for the spacer column that's always present
  const runnersColSpan = runners.length + 1;

  // Height of the super header row (Dataset/Agents row)
  const SUPER_HEADER_HEIGHT = 51;
  const DRAWER_WIDTH = 456;
  const MENU_PLUS_PADDING = 56 + 16;

  return (
    <Box
      minWidth={`calc(100vw - ${MENU_PLUS_PADDING}px + ${DRAWER_WIDTH}px)`}
      minHeight="full"
      css={{
        "& table": {
          width: "100%",
          borderCollapse: "separate",
          borderSpacing: "0",
        },
        // Super header row (first row in thead)
        "& thead tr:first-of-type th": {
          position: "sticky",
          top: 0,
          zIndex: 11,
          backgroundColor: "white",
        },
        // Column header row (second row in thead)
        "& thead tr:nth-of-type(2) th": {
          position: "sticky",
          top: `${SUPER_HEADER_HEIGHT}px`,
          zIndex: 10,
          backgroundColor: "white",
        },
        "& th": {
          borderBottom: "1px solid var(--chakra-colors-gray-200)",
          borderRight: "1px solid var(--chakra-colors-gray-100)",
          padding: "8px 12px",
          textAlign: "left",
          backgroundColor: "white",
          fontWeight: "medium",
          fontSize: "13px",
          position: "relative",
        },
        // Resize handle styles - wider hit area, narrow visible indicator
        "& .resizer": {
          position: "absolute",
          right: "-6px",
          top: 0,
          height: "100%",
          width: "12px",
          cursor: "col-resize",
          userSelect: "none",
          touchAction: "none",
          zIndex: 1,
          // Visible indicator is a pseudo-element
          "&::after": {
            content: '""',
            position: "absolute",
            right: "5px",
            top: 0,
            height: "100%",
            width: "4px",
            background: "var(--chakra-colors-blue-400)",
            opacity: 0,
            transition: "opacity 0.15s",
          },
        },
        // Only show indicator when hovering the resize area or actively resizing
        "& .resizer:hover::after, & .resizer.isResizing::after": {
          opacity: 1,
        },
        "& td": {
          borderBottom: "1px solid var(--chakra-colors-gray-100)",
          borderRight: "1px solid var(--chakra-colors-gray-100)",
          padding: "8px 12px",
          fontSize: "13px",
          verticalAlign: "top",
          // CSS variable for fade overlay gradient
          "--cell-bg": "white",
        },
        "& tr:hover td": {
          backgroundColor: "var(--chakra-colors-gray-50)",
          // Update CSS variable for fade overlay on hover
          "--cell-bg": "var(--chakra-colors-gray-50)",
        },
        // Selected row styling
        "& tr[data-selected='true'] td": {
          backgroundColor: "var(--chakra-colors-blue-50)",
          "--cell-bg": "var(--chakra-colors-blue-50)",
          "border-color": "var(--chakra-colors-blue-100)",
        },
        "& tr:has(+ tr[data-selected='true']) td": {
          "border-bottom-color": "var(--chakra-colors-blue-100)",
        },
      }}
    >
      <table ref={tableRef}>
        <thead>
          <tr>
            <SuperHeader
              type="dataset"
              colSpan={datasetColSpan}
              activeDataset={activeDataset}
              datasetHandlers={datasetHandlers}
              isLoading={isLoadingExperiment}
            />
            <SuperHeader
              type="runners"
              colSpan={runnersColSpan}
              onAddClick={() => {
                // Set flow callbacks for the entire add-runner flow
                setFlowCallbacks("promptList", {
                  onSelect: handleSelectPrompt,
                });
                setFlowCallbacks("promptEditor", {
                  onSave: handleSelectPrompt,
                });
                setFlowCallbacks("agentList", {
                  onSelect: handleSelectSavedAgent,
                });
                setFlowCallbacks("agentCodeEditor", {
                  onSave: handleSelectSavedAgent,
                });
                setFlowCallbacks("workflowSelector", {
                  onSave: handleSelectSavedAgent,
                });
                openDrawer("runnerTypeSelector");
              }}
              showWarning={runners.length === 0}
              hasComparison={runners.length > 0}
              isLoading={isLoadingExperiment}
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
                        header.getContext(),
                      )}
                  {/* Resize handle */}
                  {header.column.getCanResize() && (
                    <div
                      onMouseDown={header.getResizeHandler()}
                      onTouchStart={header.getResizeHandler()}
                      className={`resizer ${
                        header.column.getIsResizing() ? "isResizing" : ""
                      }`}
                    />
                  )}
                </th>
              ))}
              {runners.length === 0 ? (
                // Spacer column to match drawer width + default runner column width
                <th
                  style={{
                    width: DRAWER_WIDTH + 280,
                    minWidth: DRAWER_WIDTH + 280,
                  }}
                >
                  <Text fontSize="xs" color="gray.400" fontStyle="italic">
                    Click "+ Add" above to get started
                  </Text>
                </th>
              ) : (
                // Spacer column to match drawer width
                <th
                  style={{ width: DRAWER_WIDTH, minWidth: DRAWER_WIDTH }}
                ></th>
              )}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr
              key={row.id}
              data-selected={selectedRows.has(row.index) ? "true" : undefined}
            >
              {row.getVisibleCells().map((cell) => (
                <TableCell
                  key={cell.id}
                  cell={cell}
                  rowIndex={row.index}
                  activeDatasetId={activeDatasetId}
                  isLoading={isLoadingExperiment || isLoadingDatasets}
                />
              ))}
              {/* Spacer column to match drawer width */}
              <td style={{ width: DRAWER_WIDTH, minWidth: DRAWER_WIDTH }} />
            </tr>
          ))}
        </tbody>
      </table>

      <SelectionToolbar
        selectedCount={selectedRows.size}
        onRun={() => console.log("Run selected:", Array.from(selectedRows))}
        onDelete={() => deleteSelectedRows(activeDatasetId)}
        onClear={clearRowSelection}
      />

      {/* Save as dataset drawer */}
      <AddOrEditDatasetDrawer
        datasetToSave={datasetToSave}
        open={saveAsDatasetDrawerOpen}
        onClose={() => {
          setSaveAsDatasetDrawerOpen(false);
          setDatasetToSave(undefined);
        }}
        onSuccess={(savedDataset) => {
          // Replace the inline dataset with a reference to the saved one
          const currentDataset = datasets.find((d) => d.id === activeDatasetId);
          if (currentDataset && currentDataset.type === "inline") {
            // Build columns with proper types
            const columns: DatasetColumn[] = savedDataset.columnTypes.map(
              (col, index) => ({
                id: `${col.name}_${index}`,
                name: col.name,
                type: col.type as DatasetColumnType,
              }),
            );
            // Update the dataset to be a saved reference
            const updatedDataset: DatasetReference = {
              ...currentDataset,
              type: "saved",
              datasetId: savedDataset.datasetId,
              inline: undefined,
              columns,
            };
            // Remove the old dataset and add the new one
            removeDataset(currentDataset.id);
            addDataset(updatedDataset);
            setActiveDataset(updatedDataset.id);
          }
          setSaveAsDatasetDrawerOpen(false);
          setDatasetToSave(undefined);
        }}
      />

      {/* Edit dataset columns drawer */}
      <AddOrEditDatasetDrawer
        datasetToSave={
          activeDataset
            ? {
                datasetId:
                  activeDataset.type === "saved"
                    ? activeDataset.datasetId
                    : undefined,
                name: activeDataset.name,
                columnTypes: activeDataset.columns.map((col) => ({
                  name: col.name,
                  type: col.type,
                })),
                // For inline datasets, include records so column mapping works
                ...(activeDataset.type === "inline" && activeDataset.inline
                  ? {
                      datasetRecords: convertInlineToRowRecords(
                        activeDataset.inline.columns,
                        activeDataset.inline.records,
                      ),
                    }
                  : {}),
              }
            : undefined
        }
        open={editDatasetDrawerOpen}
        onClose={() => setEditDatasetDrawerOpen(false)}
        localOnly={activeDataset?.type === "inline"}
        columnVisibility={{
          hiddenColumns: ui.hiddenColumns,
          onToggleVisibility: toggleColumnVisibility,
        }}
        onSuccess={(updatedDataset) => {
          if (!activeDataset) return;

          // Build new columns from the drawer result
          const newColumns: DatasetColumn[] = updatedDataset.columnTypes.map(
            (col, index) => ({
              id: `${col.name}_${index}`,
              name: col.name,
              type: col.type as DatasetColumnType,
            }),
          );

          if (activeDataset.type === "inline") {
            // For inline datasets, update columns and map records
            const oldRecords = activeDataset.inline?.records ?? {};
            const newRecords: Record<string, string[]> = {};

            // Map old records to new columns (by name matching)
            const currentRowCount = getRowCount(activeDataset.id);
            for (const newCol of newColumns) {
              const oldCol = activeDataset.columns.find(
                (c) => c.name === newCol.name,
              );
              const oldValues = oldCol ? oldRecords[oldCol.id] : undefined;
              if (oldValues) {
                newRecords[newCol.id] = oldValues;
              } else {
                // New column, initialize with empty values
                newRecords[newCol.id] = Array(currentRowCount).fill("");
              }
            }

            updateDataset(activeDataset.id, {
              name: updatedDataset.name,
              columns: newColumns,
              inline: {
                columns: newColumns,
                records: newRecords,
              },
            });
          } else {
            // For saved datasets, just update our local reference
            // The drawer already saved to DB
            updateDataset(activeDataset.id, {
              name: updatedDataset.name,
              columns: newColumns,
              datasetId: updatedDataset.datasetId,
            });
          }

          setEditDatasetDrawerOpen(false);
        }}
      />
    </Box>
  );
}
