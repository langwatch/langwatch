import isDeepEqual from "fast-deep-equal";
import debounce from "lodash-es/debounce";
import { temporal } from "zundo";
import { create, type StateCreator } from "zustand";

import type { DatasetColumnType } from "~/server/datasets/types";

import {
  createInitialState,
  type RunnerConfig,
  type CellPosition,
  type DatasetColumn,
  type DatasetReference,
  type EvaluatorConfig,
  type EvaluationsV3Actions,
  type EvaluationsV3State,
  type EvaluationsV3Store,
  type FieldMapping,
  type OverlayType,
} from "../types";

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Remove all mappings that reference a specific dataset from runners and evaluators.
 */
const removeMappingsForDataset = (
  state: EvaluationsV3State,
  datasetId: string
): { runners: RunnerConfig[]; evaluators: EvaluatorConfig[] } => {
  // Remove dataset mappings from runners
  const runners = state.runners.map((runner) => {
    const newMappings: Record<string, FieldMapping> = {};
    for (const [field, mapping] of Object.entries(runner.mappings)) {
      // Keep value mappings and source mappings that don't reference the removed dataset
      const isDatasetMapping = mapping.type === "source" && mapping.source === "dataset" && mapping.sourceId === datasetId;
      if (!isDatasetMapping) {
        newMappings[field] = mapping;
      }
    }
    return { ...runner, mappings: newMappings };
  });

  // Remove dataset mappings from evaluators
  const evaluators = state.evaluators.map((evaluator) => {
    const newMappings: Record<string, Record<string, FieldMapping>> = {};
    for (const [runnerId, runnerMappings] of Object.entries(evaluator.mappings)) {
      const newRunnerMappings: Record<string, FieldMapping> = {};
      for (const [field, mapping] of Object.entries(runnerMappings)) {
        // Keep value mappings and source mappings that don't reference the removed dataset
        const isDatasetMapping = mapping.type === "source" && mapping.source === "dataset" && mapping.sourceId === datasetId;
        if (!isDatasetMapping) {
          newRunnerMappings[field] = mapping;
        }
      }
      newMappings[runnerId] = newRunnerMappings;
    }
    return { ...evaluator, mappings: newMappings };
  });

  return { runners, evaluators };
};

// ============================================================================
// Store Implementation
// ============================================================================

const storeImpl: StateCreator<EvaluationsV3Store> = (set, get) => ({
  ...createInitialState(),

  // -------------------------------------------------------------------------
  // Metadata actions
  // -------------------------------------------------------------------------

  setName: (name) => {
    set({ name });
  },

  setExperimentId: (experimentId) => {
    set({ experimentId });
  },

  setExperimentSlug: (experimentSlug) => {
    set({ experimentSlug });
  },

  // -------------------------------------------------------------------------
  // Dataset management actions
  // -------------------------------------------------------------------------

  addDataset: (dataset) => {
    set((state) => ({
      datasets: [...state.datasets, dataset],
    }));
  },

  removeDataset: (datasetId) => {
    set((state) => {
      // Can't remove the last dataset
      if (state.datasets.length <= 1) return state;

      // Remove the dataset
      const newDatasets = state.datasets.filter((d) => d.id !== datasetId);

      // If removing the active dataset, switch to first available
      const newActiveDatasetId =
        state.activeDatasetId === datasetId
          ? newDatasets[0]!.id
          : state.activeDatasetId;

      // Clean up mappings pointing to this dataset
      const { runners, evaluators } = removeMappingsForDataset(state, datasetId);

      return {
        datasets: newDatasets,
        activeDatasetId: newActiveDatasetId,
        runners,
        evaluators,
      };
    });
  },

  setActiveDataset: (datasetId) => {
    set((state) => {
      // Verify dataset exists
      if (!state.datasets.find((d) => d.id === datasetId)) return state;
      return { activeDatasetId: datasetId };
    });
  },

  updateDataset: (datasetId, updates) => {
    set((state) => ({
      datasets: state.datasets.map((d) =>
        d.id === datasetId ? { ...d, ...updates } : d
      ),
    }));
  },

  exportInlineToSaved: (datasetId, savedDatasetId) => {
    set((state) => ({
      datasets: state.datasets.map((d) =>
        d.id === datasetId
          ? {
              ...d,
              type: "saved" as const,
              datasetId: savedDatasetId,
              inline: undefined,
            }
          : d
      ),
    }));
  },

  // -------------------------------------------------------------------------
  // Inline dataset cell/column actions (scoped to a dataset)
  // -------------------------------------------------------------------------

  setCellValue: (datasetId, row, columnId, value) => {
    const dataset = get().datasets.find((d) => d.id === datasetId);
    if (!dataset) return;

    // For saved datasets, use updateSavedRecordValue
    if (dataset.type === "saved") {
      get().updateSavedRecordValue(datasetId, row, columnId, value);
      return;
    }

    // For inline datasets, update local records
    if (dataset.type === "inline" && dataset.inline) {
      set((state) => {
        const records = { ...(state.datasets.find((d) => d.id === datasetId)?.inline?.records ?? {}) };
        const columnValues = [...(records[columnId] ?? [])];

        // Ensure array is long enough
        while (columnValues.length <= row) {
          columnValues.push("");
        }

        columnValues[row] = value;
        records[columnId] = columnValues;

        return {
          datasets: state.datasets.map((d) =>
            d.id === datasetId
              ? {
                  ...d,
                  inline: {
                    ...d.inline!,
                    records,
                  },
                }
              : d
          ),
        };
      });
    }
  },

  addColumn: (datasetId, column) => {
    set((state) => {
      const dataset = state.datasets.find((d) => d.id === datasetId);
      if (!dataset || dataset.type !== "inline" || !dataset.inline) {
        return state;
      }

      const rowCount = get().getRowCount(datasetId);
      const newColumnValues = Array(rowCount).fill("");

      return {
        datasets: state.datasets.map((d) =>
          d.id === datasetId
            ? {
                ...d,
                columns: [...d.columns, column],
                inline: {
                  ...d.inline!,
                  columns: [...d.inline!.columns, column],
                  records: {
                    ...d.inline!.records,
                    [column.id]: newColumnValues,
                  },
                },
              }
            : d
        ),
      };
    });
  },

  removeColumn: (datasetId, columnId) => {
    set((state) => {
      const dataset = state.datasets.find((d) => d.id === datasetId);
      if (!dataset || dataset.type !== "inline" || !dataset.inline) {
        return state;
      }

      const columns = dataset.inline.columns.filter((c) => c.id !== columnId);
      const records = { ...dataset.inline.records };
      delete records[columnId];

      return {
        datasets: state.datasets.map((d) =>
          d.id === datasetId
            ? {
                ...d,
                columns: d.columns.filter((c) => c.id !== columnId),
                inline: {
                  ...d.inline!,
                  columns,
                  records,
                },
              }
            : d
        ),
      };
    });
  },

  renameColumn: (datasetId, columnId, newName) => {
    set((state) => {
      const dataset = state.datasets.find((d) => d.id === datasetId);
      if (!dataset || dataset.type !== "inline" || !dataset.inline) {
        return state;
      }

      const updateColumns = (cols: DatasetColumn[]) =>
        cols.map((c) => (c.id === columnId ? { ...c, name: newName } : c));

      return {
        datasets: state.datasets.map((d) =>
          d.id === datasetId
            ? {
                ...d,
                columns: updateColumns(d.columns),
                inline: {
                  ...d.inline!,
                  columns: updateColumns(d.inline!.columns),
                },
              }
            : d
        ),
      };
    });
  },

  updateColumnType: (datasetId, columnId, type) => {
    set((state) => {
      const dataset = state.datasets.find((d) => d.id === datasetId);
      if (!dataset || dataset.type !== "inline" || !dataset.inline) {
        return state;
      }

      const updateColumns = (cols: DatasetColumn[]) =>
        cols.map((c) => (c.id === columnId ? { ...c, type } : c));

      return {
        datasets: state.datasets.map((d) =>
          d.id === datasetId
            ? {
                ...d,
                columns: updateColumns(d.columns),
                inline: {
                  ...d.inline!,
                  columns: updateColumns(d.inline!.columns),
                },
              }
            : d
        ),
      };
    });
  },

  getRowCount: (datasetId) => {
    const state = get();
    const dataset = state.datasets.find((d) => d.id === datasetId);
    if (!dataset) return 0;

    // Handle inline datasets
    if (dataset.type === "inline" && dataset.inline) {
      const columnValues = Object.values(dataset.inline.records);
      if (columnValues.length === 0) return 0;
      return Math.max(...columnValues.map((v) => v.length));
    }

    // Handle saved datasets with cached records
    if (dataset.type === "saved" && dataset.savedRecords) {
      return dataset.savedRecords.length;
    }

    return 0;
  },

  getCellValue: (datasetId, row, columnId) => {
    const state = get();
    const dataset = state.datasets.find((d) => d.id === datasetId);
    if (!dataset) return "";

    // Handle inline datasets
    if (dataset.type === "inline" && dataset.inline) {
      return dataset.inline.records[columnId]?.[row] ?? "";
    }

    // Handle saved datasets with cached records
    if (dataset.type === "saved" && dataset.savedRecords) {
      const record = dataset.savedRecords[row];
      if (!record) return "";
      // Use column name to get value (savedRecords use column names, not IDs)
      const column = dataset.columns.find((c) => c.id === columnId);
      if (!column) return "";
      const value = record[column.name];
      return typeof value === "string" ? value : String(value ?? "");
    }

    return "";
  },

  updateSavedRecordValue: (datasetId, rowIndex, columnId, value) => {
    set((state) => {
      const dataset = state.datasets.find((d) => d.id === datasetId);
      if (!dataset || dataset.type !== "saved" || !dataset.datasetId) {
        return state;
      }

      // Get column name from column id
      const column = dataset.columns.find((c) => c.id === columnId);
      if (!column) return state;

      const existingRecords = dataset.savedRecords ?? [];
      const record = existingRecords[rowIndex];

      // If record doesn't exist, create a new one
      if (!record) {
        // Generate a temporary ID for the new record (will be replaced when synced to DB)
        const newRecordId = `new_${Date.now()}_${rowIndex}`;
        const newRecord = {
          id: newRecordId,
          // Initialize all columns with empty values
          ...Object.fromEntries(dataset.columns.map((c) => [c.name, ""])),
          [column.name]: value,
        };

        const updatedRecords = [...existingRecords];
        // Ensure array is long enough
        while (updatedRecords.length < rowIndex) {
          updatedRecords.push({
            id: `new_${Date.now()}_${updatedRecords.length}`,
            ...Object.fromEntries(dataset.columns.map((c) => [c.name, ""])),
          });
        }
        updatedRecords[rowIndex] = newRecord;

        // Track as pending new record for DB sync
        const pendingSavedChanges = { ...state.pendingSavedChanges };
        const datasetChanges = pendingSavedChanges[dataset.datasetId] ?? {};
        pendingSavedChanges[dataset.datasetId] = {
          ...datasetChanges,
          [newRecordId]: newRecord,
        };

        return {
          datasets: state.datasets.map((d) =>
            d.id === datasetId
              ? { ...d, savedRecords: updatedRecords }
              : d
          ),
          pendingSavedChanges,
        };
      }

      // Update existing record
      const updatedRecords = [...existingRecords];
      updatedRecords[rowIndex] = {
        ...record,
        [column.name]: value,
      };

      // Track pending changes for DB sync
      const pendingSavedChanges = { ...state.pendingSavedChanges };
      const datasetChanges = pendingSavedChanges[dataset.datasetId] ?? {};
      const recordChanges = datasetChanges[record.id] ?? {};

      pendingSavedChanges[dataset.datasetId] = {
        ...datasetChanges,
        [record.id]: {
          ...recordChanges,
          [column.name]: value,
        },
      };

      return {
        datasets: state.datasets.map((d) =>
          d.id === datasetId
            ? { ...d, savedRecords: updatedRecords }
            : d
        ),
        pendingSavedChanges,
      };
    });
  },

  clearPendingChange: (dbDatasetId, recordId) => {
    set((state) => {
      const pendingSavedChanges = { ...state.pendingSavedChanges };
      const datasetChanges = { ...(pendingSavedChanges[dbDatasetId] ?? {}) };
      delete datasetChanges[recordId];

      if (Object.keys(datasetChanges).length === 0) {
        delete pendingSavedChanges[dbDatasetId];
      } else {
        pendingSavedChanges[dbDatasetId] = datasetChanges;
      }

      return { pendingSavedChanges };
    });
  },

  getSavedRecordInfo: (datasetId, rowIndex) => {
    const state = get();
    const dataset = state.datasets.find((d) => d.id === datasetId);
    if (!dataset || dataset.type !== "saved" || !dataset.savedRecords || !dataset.datasetId) {
      return null;
    }

    const record = dataset.savedRecords[rowIndex];
    if (!record) return null;

    return {
      dbDatasetId: dataset.datasetId,
      recordId: record.id,
    };
  },

  // -------------------------------------------------------------------------
  // Runner actions
  // -------------------------------------------------------------------------

  addRunner: (runner) => {
    set((state) => ({
      runners: [...state.runners, runner],
    }));
  },

  updateRunner: (runnerId, updates) => {
    set((state) => ({
      runners: state.runners.map((r) =>
        r.id === runnerId ? { ...r, ...updates } : r
      ),
    }));
  },

  removeRunner: (runnerId) => {
    set((state) => {
      // Also remove this runner's mappings from all evaluators
      const evaluators = state.evaluators.map((e) => {
        const mappings = { ...e.mappings };
        delete mappings[runnerId];
        return { ...e, mappings };
      });

      // Also remove mappings that reference this runner from other runners
      const runners = state.runners
        .filter((r) => r.id !== runnerId)
        .map((runner) => {
          const newMappings: Record<string, FieldMapping> = {};
          for (const [field, mapping] of Object.entries(runner.mappings)) {
            // Keep value mappings and source mappings that don't reference the removed runner
            const isRunnerMapping = mapping.type === "source" && mapping.source === "runner" && mapping.sourceId === runnerId;
            if (!isRunnerMapping) {
              newMappings[field] = mapping;
            }
          }
          return { ...runner, mappings: newMappings };
        });

      return { runners, evaluators };
    });
  },

  setRunnerMapping: (runnerId, inputField, mapping) => {
    set((state) => ({
      runners: state.runners.map((r) =>
        r.id === runnerId
          ? {
              ...r,
              mappings: {
                ...r.mappings,
                [inputField]: mapping,
              },
            }
          : r
      ),
    }));
  },

  // -------------------------------------------------------------------------
  // Global evaluator actions
  // -------------------------------------------------------------------------

  addEvaluator: (evaluator) => {
    set((state) => ({
      evaluators: [...state.evaluators, evaluator],
    }));
  },

  updateEvaluator: (evaluatorId, updates) => {
    set((state) => ({
      evaluators: state.evaluators.map((e) =>
        e.id === evaluatorId ? { ...e, ...updates } : e
      ),
    }));
  },

  removeEvaluator: (evaluatorId) => {
    set((state) => ({
      evaluators: state.evaluators.filter((e) => e.id !== evaluatorId),
      // Also remove this evaluator from all runners' evaluatorIds
      runners: state.runners.map((r) => ({
        ...r,
        evaluatorIds: r.evaluatorIds.filter((id) => id !== evaluatorId),
      })),
    }));
  },

  // -------------------------------------------------------------------------
  // Runner-evaluator relationship actions
  // -------------------------------------------------------------------------

  addEvaluatorToRunner: (runnerId, evaluatorId) => {
    set((state) => {
      const runner = state.runners.find((r) => r.id === runnerId);
      if (!runner) return state;

      // Check if evaluator exists
      const evaluator = state.evaluators.find((e) => e.id === evaluatorId);
      if (!evaluator) return state;

      // Don't add if already exists
      if (runner.evaluatorIds.includes(evaluatorId)) return state;

      return {
        runners: state.runners.map((r) =>
          r.id === runnerId
            ? { ...r, evaluatorIds: [...r.evaluatorIds, evaluatorId] }
            : r
        ),
        // Initialize empty mappings for this runner in the evaluator
        evaluators: state.evaluators.map((e) =>
          e.id === evaluatorId
            ? {
                ...e,
                mappings: {
                  ...e.mappings,
                  [runnerId]: e.mappings[runnerId] ?? {},
                },
              }
            : e
        ),
      };
    });
  },

  removeEvaluatorFromRunner: (runnerId, evaluatorId) => {
    set((state) => ({
      runners: state.runners.map((r) =>
        r.id === runnerId
          ? {
              ...r,
              evaluatorIds: r.evaluatorIds.filter((id) => id !== evaluatorId),
            }
          : r
      ),
      // Remove this runner's mappings from the evaluator
      evaluators: state.evaluators.map((e) => {
        if (e.id !== evaluatorId) return e;
        const mappings = { ...e.mappings };
        delete mappings[runnerId];
        return { ...e, mappings };
      }),
    }));
  },

  // -------------------------------------------------------------------------
  // Evaluator mapping actions (per-runner mappings stored inside evaluator)
  // -------------------------------------------------------------------------

  setEvaluatorMapping: (evaluatorId, runnerId, inputField, mapping) => {
    set((state) => ({
      evaluators: state.evaluators.map((e) =>
        e.id === evaluatorId
          ? {
              ...e,
              mappings: {
                ...e.mappings,
                [runnerId]: {
                  ...e.mappings[runnerId],
                  [inputField]: mapping,
                },
              },
            }
          : e
      ),
    }));
  },

  // -------------------------------------------------------------------------
  // Results actions
  // -------------------------------------------------------------------------

  setResults: (results) => {
    set((state) => ({
      results: {
        ...state.results,
        ...results,
      },
    }));
  },

  clearResults: () => {
    set({
      results: {
        status: "idle",
        runnerOutputs: {},
        evaluatorResults: {},
        errors: {},
      },
    });
  },

  // -------------------------------------------------------------------------
  // UI actions
  // -------------------------------------------------------------------------

  openOverlay: (type, targetId, evaluatorId) => {
    set({
      ui: {
        ...get().ui,
        openOverlay: type,
        overlayTargetId: targetId,
        overlayEvaluatorId: evaluatorId,
      },
    });
  },

  closeOverlay: () => {
    set({
      ui: {
        ...get().ui,
        openOverlay: undefined,
        overlayTargetId: undefined,
        overlayEvaluatorId: undefined,
      },
    });
  },

  setSelectedCell: (cell) => {
    set({
      ui: {
        ...get().ui,
        selectedCell: cell,
      },
    });
  },

  setEditingCell: (cell) => {
    set({
      ui: {
        ...get().ui,
        editingCell: cell,
      },
    });
  },

  toggleRowSelection: (row) => {
    set((state) => {
      const newSelected = new Set(state.ui.selectedRows);
      if (newSelected.has(row)) {
        newSelected.delete(row);
      } else {
        newSelected.add(row);
      }
      return {
        ui: {
          ...state.ui,
          selectedRows: newSelected,
        },
      };
    });
  },

  selectAllRows: (rowCount) => {
    set((state) => ({
      ui: {
        ...state.ui,
        selectedRows: new Set(Array.from({ length: rowCount }, (_, i) => i)),
      },
    }));
  },

  clearRowSelection: () => {
    set((state) => ({
      ui: {
        ...state.ui,
        selectedRows: new Set(),
      },
    }));
  },

  deleteSelectedRows: (datasetId) => {
    const state = get();
    const selectedRows = state.ui.selectedRows;
    if (selectedRows.size === 0) return;

    const dataset = state.datasets.find((d) => d.id === datasetId);
    if (!dataset) return;

    // Sort indices in descending order to delete from end first
    // This prevents index shifting issues
    const sortedIndices = Array.from(selectedRows).sort((a, b) => b - a);

    if (dataset.type === "inline" && dataset.inline) {
      // For inline datasets, remove values from each column's array
      set((currentState) => {
        const currentDataset = currentState.datasets.find((d) => d.id === datasetId);
        if (!currentDataset || currentDataset.type !== "inline" || !currentDataset.inline) {
          return currentState;
        }

        const newRecords: Record<string, string[]> = {};

        // For each column, filter out the selected row indices
        for (const [columnId, values] of Object.entries(currentDataset.inline.records)) {
          const newValues = values.filter((_, index) => !selectedRows.has(index));
          newRecords[columnId] = newValues;
        }

        // Ensure we have at least one empty row (the "last empty white line")
        const rowCount = Object.values(newRecords)[0]?.length ?? 0;
        if (rowCount === 0) {
          for (const columnId of Object.keys(newRecords)) {
            newRecords[columnId] = [""];
          }
        }

        return {
          datasets: currentState.datasets.map((d) =>
            d.id === datasetId
              ? {
                  ...d,
                  inline: {
                    ...d.inline!,
                    records: newRecords,
                  },
                }
              : d
          ),
          ui: {
            ...currentState.ui,
            selectedRows: new Set(),
            // Clear editing/selection state to avoid referencing deleted rows
            selectedCell: undefined,
            editingCell: undefined,
          },
        };
      });
    } else if (dataset.type === "saved" && dataset.savedRecords) {
      // For saved datasets, filter out the records and track which to delete from DB
      set((currentState) => {
        const currentDataset = currentState.datasets.find((d) => d.id === datasetId);
        if (!currentDataset || currentDataset.type !== "saved" || !currentDataset.savedRecords) {
          return currentState;
        }

        // Filter out selected records
        const newRecords = currentDataset.savedRecords.filter(
          (_, index) => !selectedRows.has(index)
        );

        // Track record IDs to delete (for existing records, not new ones)
        const recordsToDelete = currentDataset.savedRecords
          .filter((_, index) => selectedRows.has(index))
          .map((record) => record.id)
          .filter((id) => !id.startsWith("new_")); // Only delete persisted records

        // Store pending deletions in pendingSavedChanges
        const dbDatasetId = currentDataset.datasetId;
        const pendingChanges = { ...currentState.pendingSavedChanges };

        if (dbDatasetId && recordsToDelete.length > 0) {
          // Mark records for deletion using nested structure: datasetId -> recordId -> { _delete: true }
          if (!pendingChanges[dbDatasetId]) {
            pendingChanges[dbDatasetId] = {};
          }
          for (const recordId of recordsToDelete) {
            pendingChanges[dbDatasetId]![recordId] = { _delete: true };
          }
        }

        return {
          datasets: currentState.datasets.map((d) =>
            d.id === datasetId
              ? {
                  ...d,
                  savedRecords: newRecords,
                }
              : d
          ),
          pendingSavedChanges: pendingChanges,
          ui: {
            ...currentState.ui,
            selectedRows: new Set(),
            selectedCell: undefined,
            editingCell: undefined,
          },
        };
      });
    }
  },

  setExpandedEvaluator: (expanded) => {
    set((state) => ({
      ui: {
        ...state.ui,
        expandedEvaluator: expanded,
      },
    }));
  },

  setColumnWidth: (columnId, width) => {
    set((state) => ({
      ui: {
        ...state.ui,
        columnWidths: {
          ...state.ui.columnWidths,
          [columnId]: width,
        },
      },
    }));
  },

  setColumnWidths: (widths) => {
    set((state) => ({
      ui: {
        ...state.ui,
        columnWidths: {
          ...state.ui.columnWidths,
          ...widths,
        },
      },
    }));
  },

  setRowHeightMode: (mode) => {
    set((state) => ({
      ui: {
        ...state.ui,
        rowHeightMode: mode,
        // Clear individually expanded cells when switching modes
        expandedCells: new Set(),
      },
    }));
  },

  toggleCellExpanded: (row, columnId) => {
    set((state) => {
      const key = `${row}-${columnId}`;
      const newExpandedCells = new Set(state.ui.expandedCells);
      if (newExpandedCells.has(key)) {
        newExpandedCells.delete(key);
      } else {
        newExpandedCells.add(key);
      }
      return {
        ui: {
          ...state.ui,
          expandedCells: newExpandedCells,
        },
      };
    });
  },

  toggleColumnVisibility: (columnName) => {
    set((state) => {
      const newHiddenColumns = new Set(state.ui.hiddenColumns);
      if (newHiddenColumns.has(columnName)) {
        newHiddenColumns.delete(columnName);
      } else {
        newHiddenColumns.add(columnName);
      }
      return {
        ui: {
          ...state.ui,
          hiddenColumns: newHiddenColumns,
        },
      };
    });
  },

  setHiddenColumns: (columnNames) => {
    set((state) => ({
      ui: {
        ...state.ui,
        hiddenColumns: columnNames,
      },
    }));
  },

  setAutosaveStatus: (type, state, error) => {
    set((currentState) => ({
      ui: {
        ...currentState.ui,
        autosaveStatus: {
          ...currentState.ui.autosaveStatus,
          [type]: state,
          [`${type}Error`]: error,
        },
      },
    }));
  },

  // -------------------------------------------------------------------------
  // Reset
  // -------------------------------------------------------------------------

  reset: () => {
    set(createInitialState());
  },

  loadState: (wizardState: unknown) => {
    if (!wizardState || typeof wizardState !== "object") return;

    const state = wizardState as Record<string, unknown>;

    set((current) => ({
      ...current,
      experimentId: (state.experimentId as string) ?? current.experimentId,
      experimentSlug: (state.experimentSlug as string) ?? current.experimentSlug,
      name: (state.name as string) ?? current.name,
      datasets: (state.datasets as typeof current.datasets) ?? current.datasets,
      activeDatasetId: (state.activeDatasetId as string) ?? current.activeDatasetId,
      evaluators: (state.evaluators as typeof current.evaluators) ?? current.evaluators,
      // Support loading old state format (agents) and new format (runners)
      runners: (state.runners as typeof current.runners) ?? (state.agents as typeof current.runners) ?? current.runners,
    }));
  },

  setSavedDatasetRecords: (datasetId: string, records) => {
    set((state) => ({
      datasets: state.datasets.map((d) =>
        d.id === datasetId && d.type === "saved"
          ? { ...d, savedRecords: records }
          : d
      ),
    }));
  },
});

// ============================================================================
// Temporal (Undo/Redo) Configuration
// ============================================================================

/**
 * State subset used for equality comparison to determine if a new history entry should be created.
 *
 * IMPORTANT: We intentionally EXCLUDE selectedCell from equality comparison.
 * This means navigation-only changes won't create new undo entries.
 * However, when a content change DOES happen, the full state (including selectedCell)
 * is saved, so undo will restore both the content AND the selection at that point.
 */
type PartializedState = Pick<
  EvaluationsV3State,
  "name" | "datasets" | "activeDatasetId" | "evaluators" | "runners"
>;

/**
 * Partialize state for equality comparison only.
 * Used to determine if a new history entry should be created.
 * Does NOT include selectedCell - navigation alone won't create undo entries.
 */
const partializeState = (state: EvaluationsV3Store): PartializedState => ({
  name: state.name,
  datasets: state.datasets,
  activeDatasetId: state.activeDatasetId,
  evaluators: state.evaluators,
  runners: state.runners,
});

/**
 * Create the store with temporal middleware for undo/redo support.
 * Note: We use performUndo/performRedo which clear editingCell after undo/redo
 * to prevent users from getting stuck in edit mode when undoing.
 */
export const useEvaluationsV3Store = create<EvaluationsV3Store>()(
  temporal(storeImpl, {
    handleSet: (handleSet) => {
      return debounce<typeof handleSet>(
        (pastState) => {
          handleSet(pastState);
        },
        // Debounce to batch rapid changes (like typing) into single undo entries
        100,
        { leading: true, trailing: false }
      );
    },
    equality: (pastState, currentState) => {
      return isDeepEqual(
        partializeState(pastState as EvaluationsV3Store),
        partializeState(currentState as EvaluationsV3Store)
      );
    },
  })
);

// ============================================================================
// Temporal Store Hook
// ============================================================================

/**
 * Hook to access undo/redo functionality.
 */
export const useEvaluationsV3Temporal = () => {
  return useEvaluationsV3Store.temporal;
};

/**
 * Hook to check if undo is available.
 */
export const useCanUndo = () => {
  const pastStates = useEvaluationsV3Store.temporal.getState().pastStates;
  return pastStates.length > 0;
};

/**
 * Hook to check if redo is available.
 */
export const useCanRedo = () => {
  const futureStates = useEvaluationsV3Store.temporal.getState().futureStates;
  return futureStates.length > 0;
};

/**
 * Hook to perform undo.
 */
export const useUndo = () => {
  return useEvaluationsV3Store.temporal.getState().undo;
};

/**
 * Hook to perform redo.
 */
export const useRedo = () => {
  return useEvaluationsV3Store.temporal.getState().redo;
};

/**
 * Perform undo and clear editingCell to prevent getting stuck in edit mode.
 * Use this instead of temporal.getState().undo() directly.
 */
export const performUndo = () => {
  const temporal = useEvaluationsV3Store.temporal.getState();
  if (temporal.pastStates.length > 0) {
    temporal.undo();
    // Clear editingCell after undo - we want to restore content, not edit mode
    useEvaluationsV3Store.getState().setEditingCell(undefined);
  }
};

/**
 * Perform redo and clear editingCell to prevent getting stuck in edit mode.
 * Use this instead of temporal.getState().redo() directly.
 */
export const performRedo = () => {
  const temporal = useEvaluationsV3Store.temporal.getState();
  if (temporal.futureStates.length > 0) {
    temporal.redo();
    // Clear editingCell after redo - we want to restore content, not edit mode
    useEvaluationsV3Store.getState().setEditingCell(undefined);
  }
};
