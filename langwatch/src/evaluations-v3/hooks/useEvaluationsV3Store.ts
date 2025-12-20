import isDeepEqual from "fast-deep-equal";
import debounce from "lodash-es/debounce";
import { temporal } from "zundo";
import { create, type StateCreator } from "zustand";

import type { DatasetColumnType } from "~/server/datasets/types";

import {
  createInitialState,
  type AgentConfig,
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
 * Remove all mappings that reference a specific dataset from agents and evaluators.
 */
const removeMappingsForDataset = (
  state: EvaluationsV3State,
  datasetId: string
): { agents: AgentConfig[]; evaluators: EvaluatorConfig[] } => {
  // Remove dataset mappings from agents
  const agents = state.agents.map((agent) => {
    const newMappings: Record<string, FieldMapping> = {};
    for (const [field, mapping] of Object.entries(agent.mappings)) {
      if (!(mapping.source === "dataset" && mapping.sourceId === datasetId)) {
        newMappings[field] = mapping;
      }
    }
    return { ...agent, mappings: newMappings };
  });

  // Remove dataset mappings from evaluators
  const evaluators = state.evaluators.map((evaluator) => {
    const newMappings: Record<string, Record<string, FieldMapping>> = {};
    for (const [agentId, agentMappings] of Object.entries(evaluator.mappings)) {
      const newAgentMappings: Record<string, FieldMapping> = {};
      for (const [field, mapping] of Object.entries(agentMappings)) {
        if (!(mapping.source === "dataset" && mapping.sourceId === datasetId)) {
          newAgentMappings[field] = mapping;
        }
      }
      newMappings[agentId] = newAgentMappings;
    }
    return { ...evaluator, mappings: newMappings };
  });

  return { agents, evaluators };
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
      const { agents, evaluators } = removeMappingsForDataset(state, datasetId);

      return {
        datasets: newDatasets,
        activeDatasetId: newActiveDatasetId,
        agents,
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
  // Agent actions
  // -------------------------------------------------------------------------

  addAgent: (agent) => {
    set((state) => ({
      agents: [...state.agents, agent],
    }));
  },

  updateAgent: (agentId, updates) => {
    set((state) => ({
      agents: state.agents.map((a) =>
        a.id === agentId ? { ...a, ...updates } : a
      ),
    }));
  },

  removeAgent: (agentId) => {
    set((state) => {
      // Also remove this agent's mappings from all evaluators
      const evaluators = state.evaluators.map((e) => {
        const mappings = { ...e.mappings };
        delete mappings[agentId];
        return { ...e, mappings };
      });

      // Also remove mappings that reference this agent from other agents
      const agents = state.agents
        .filter((a) => a.id !== agentId)
        .map((agent) => {
          const newMappings: Record<string, FieldMapping> = {};
          for (const [field, mapping] of Object.entries(agent.mappings)) {
            if (
              !(mapping.source === "agent" && mapping.sourceId === agentId)
            ) {
              newMappings[field] = mapping;
            }
          }
          return { ...agent, mappings: newMappings };
        });

      return { agents, evaluators };
    });
  },

  setAgentMapping: (agentId, inputField, mapping) => {
    set((state) => ({
      agents: state.agents.map((a) =>
        a.id === agentId
          ? {
              ...a,
              mappings: {
                ...a.mappings,
                [inputField]: mapping,
              },
            }
          : a
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
      // Also remove this evaluator from all agents' evaluatorIds
      agents: state.agents.map((a) => ({
        ...a,
        evaluatorIds: a.evaluatorIds.filter((id) => id !== evaluatorId),
      })),
    }));
  },

  // -------------------------------------------------------------------------
  // Agent-evaluator relationship actions
  // -------------------------------------------------------------------------

  addEvaluatorToAgent: (agentId, evaluatorId) => {
    set((state) => {
      const agent = state.agents.find((a) => a.id === agentId);
      if (!agent) return state;

      // Check if evaluator exists
      const evaluator = state.evaluators.find((e) => e.id === evaluatorId);
      if (!evaluator) return state;

      // Don't add if already exists
      if (agent.evaluatorIds.includes(evaluatorId)) return state;

      return {
        agents: state.agents.map((a) =>
          a.id === agentId
            ? { ...a, evaluatorIds: [...a.evaluatorIds, evaluatorId] }
            : a
        ),
        // Initialize empty mappings for this agent in the evaluator
        evaluators: state.evaluators.map((e) =>
          e.id === evaluatorId
            ? {
                ...e,
                mappings: {
                  ...e.mappings,
                  [agentId]: e.mappings[agentId] ?? {},
                },
              }
            : e
        ),
      };
    });
  },

  removeEvaluatorFromAgent: (agentId, evaluatorId) => {
    set((state) => ({
      agents: state.agents.map((a) =>
        a.id === agentId
          ? {
              ...a,
              evaluatorIds: a.evaluatorIds.filter((id) => id !== evaluatorId),
            }
          : a
      ),
      // Remove this agent's mappings from the evaluator
      evaluators: state.evaluators.map((e) => {
        if (e.id !== evaluatorId) return e;
        const mappings = { ...e.mappings };
        delete mappings[agentId];
        return { ...e, mappings };
      }),
    }));
  },

  // -------------------------------------------------------------------------
  // Evaluator mapping actions (per-agent mappings stored inside evaluator)
  // -------------------------------------------------------------------------

  setEvaluatorMapping: (evaluatorId, agentId, inputField, mapping) => {
    set((state) => ({
      evaluators: state.evaluators.map((e) =>
        e.id === evaluatorId
          ? {
              ...e,
              mappings: {
                ...e.mappings,
                [agentId]: {
                  ...e.mappings[agentId],
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
        agentOutputs: {},
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

  // -------------------------------------------------------------------------
  // Reset
  // -------------------------------------------------------------------------

  reset: () => {
    set(createInitialState());
  },
});

// ============================================================================
// Temporal (Undo/Redo) Configuration
// ============================================================================

/**
 * State subset that should be tracked for undo/redo.
 * Excludes UI state and results since they're transient.
 */
type PartializedState = Pick<
  EvaluationsV3State,
  "name" | "datasets" | "activeDatasetId" | "evaluators" | "agents"
>;

/**
 * Partialize state for undo/redo comparison.
 * We exclude UI state and results from undo/redo tracking since they're transient.
 */
const partializeState = (state: EvaluationsV3Store): PartializedState => ({
  name: state.name,
  datasets: state.datasets,
  activeDatasetId: state.activeDatasetId,
  evaluators: state.evaluators,
  agents: state.agents,
});

/**
 * Create the store with temporal middleware for undo/redo support.
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
