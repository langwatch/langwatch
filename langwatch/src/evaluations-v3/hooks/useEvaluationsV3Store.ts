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
      agentMappings: {
        ...state.agentMappings,
        [agent.id]: {},
      },
      evaluatorMappings: {
        ...state.evaluatorMappings,
        [agent.id]: {},
      },
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
      const agentMappings = { ...state.agentMappings };
      delete agentMappings[agentId];

      const evaluatorMappings = { ...state.evaluatorMappings };
      delete evaluatorMappings[agentId];

      return {
        agents: state.agents.filter((a) => a.id !== agentId),
        agentMappings,
        evaluatorMappings,
      };
    });
  },

  setAgentMapping: (agentId, inputField, mapping) => {
    set((state) => ({
      agentMappings: {
        ...state.agentMappings,
        [agentId]: {
          ...state.agentMappings[agentId],
          [inputField]: mapping,
        },
      },
    }));
  },

  // -------------------------------------------------------------------------
  // Per-agent evaluator actions
  // -------------------------------------------------------------------------

  addEvaluatorToAgent: (agentId, evaluator) => {
    set((state) => {
      const agent = state.agents.find((a) => a.id === agentId);
      if (!agent) return state;

      return {
        agents: state.agents.map((a) =>
          a.id === agentId
            ? { ...a, evaluators: [...a.evaluators, evaluator] }
            : a
        ),
        evaluatorMappings: {
          ...state.evaluatorMappings,
          [agentId]: {
            ...state.evaluatorMappings[agentId],
            [evaluator.id]: {},
          },
        },
      };
    });
  },

  updateAgentEvaluator: (agentId, evaluatorId, updates) => {
    set((state) => ({
      agents: state.agents.map((a) =>
        a.id === agentId
          ? {
              ...a,
              evaluators: a.evaluators.map((e) =>
                e.id === evaluatorId ? { ...e, ...updates } : e
              ),
            }
          : a
      ),
    }));
  },

  removeAgentEvaluator: (agentId, evaluatorId) => {
    set((state) => {
      const evaluatorMappings = { ...state.evaluatorMappings };
      if (evaluatorMappings[agentId]) {
        const agentEvalMappings = { ...evaluatorMappings[agentId] };
        delete agentEvalMappings[evaluatorId];
        evaluatorMappings[agentId] = agentEvalMappings;
      }

      return {
        agents: state.agents.map((a) =>
          a.id === agentId
            ? { ...a, evaluators: a.evaluators.filter((e) => e.id !== evaluatorId) }
            : a
        ),
        evaluatorMappings,
      };
    });
  },

  setAgentEvaluatorMapping: (agentId, evaluatorId, inputField, mapping) => {
    set((state) => ({
      evaluatorMappings: {
        ...state.evaluatorMappings,
        [agentId]: {
          ...state.evaluatorMappings[agentId],
          [evaluatorId]: {
            ...state.evaluatorMappings[agentId]?.[evaluatorId],
            [inputField]: mapping,
          },
        },
      },
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
  "name" | "dataset" | "agents" | "agentMappings" | "evaluatorMappings"
>;

/**
 * Partialize state for undo/redo comparison.
 * We exclude UI state and results from undo/redo tracking since they're transient.
 */
const partializeState = (state: EvaluationsV3Store): PartializedState => ({
  name: state.name,
  dataset: state.dataset,
  agents: state.agents,
  agentMappings: state.agentMappings,
  evaluatorMappings: state.evaluatorMappings,
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
