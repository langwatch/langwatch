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
  type EvaluatorConfig,
  type EvaluationsV3Actions,
  type EvaluationsV3State,
  type EvaluationsV3Store,
  type FieldMapping,
  type InlineDataset,
  type OverlayType,
} from "../types";

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
  // Dataset actions
  // -------------------------------------------------------------------------

  setCellValue: (row, columnId, value) => {
    set((state) => {
      const records = { ...state.dataset.records };
      const columnValues = [...(records[columnId] ?? [])];

      // Ensure array is long enough
      while (columnValues.length <= row) {
        columnValues.push("");
      }

      columnValues[row] = value;
      records[columnId] = columnValues;

      return {
        dataset: {
          ...state.dataset,
          records,
        },
      };
    });
  },

  addColumn: (column) => {
    set((state) => {
      const rowCount = get().getRowCount();
      const newColumnValues = Array(rowCount).fill("");

      return {
        dataset: {
          ...state.dataset,
          columns: [...state.dataset.columns, column],
          records: {
            ...state.dataset.records,
            [column.id]: newColumnValues,
          },
        },
      };
    });
  },

  removeColumn: (columnId) => {
    set((state) => {
      const columns = state.dataset.columns.filter((c) => c.id !== columnId);
      const records = { ...state.dataset.records };
      delete records[columnId];

      return {
        dataset: {
          ...state.dataset,
          columns,
          records,
        },
      };
    });
  },

  renameColumn: (columnId, newName) => {
    set((state) => {
      const columns = state.dataset.columns.map((c) =>
        c.id === columnId ? { ...c, name: newName } : c
      );

      return {
        dataset: {
          ...state.dataset,
          columns,
        },
      };
    });
  },

  updateColumnType: (columnId, type) => {
    set((state) => {
      const columns = state.dataset.columns.map((c) =>
        c.id === columnId ? { ...c, type } : c
      );

      return {
        dataset: {
          ...state.dataset,
          columns,
        },
      };
    });
  },

  setDataset: (dataset) => {
    set({ dataset });
  },

  getRowCount: () => {
    const state = get();
    const columnValues = Object.values(state.dataset.records);
    if (columnValues.length === 0) return 0;
    return Math.max(...columnValues.map((v) => v.length));
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

      return {
        agents: state.agents.filter((a) => a.id !== agentId),
        evaluators,
      };
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
          ? { ...a, evaluatorIds: a.evaluatorIds.filter((id) => id !== evaluatorId) }
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
  "name" | "dataset" | "evaluators" | "agents"
>;

/**
 * Partialize state for undo/redo comparison.
 * We exclude UI state and results from undo/redo tracking since they're transient.
 */
const partializeState = (state: EvaluationsV3Store): PartializedState => ({
  name: state.name,
  dataset: state.dataset,
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
