/**
 * Evaluation V3 Store
 *
 * Main Zustand store for the spreadsheet-based evaluation experience.
 * Uses temporal middleware for undo/redo support.
 */

import { create } from "zustand";
import { temporal } from "zundo";
import debounce from "lodash-es/debounce";
import isDeepEqual from "fast-deep-equal";

import {
  type EvaluationV3State,
  type Agent,
  type Evaluator,
  type DatasetColumn,
  type DatasetRow,
  type AgentMapping,
  type EvaluatorMapping,
  type ActiveModal,
  type ExpandedCell,
  type EvaluationRun,
  type InlineDataset,
  type MappingSource,
  INITIAL_STATE,
  createEmptyRow,
} from "../types";

// ============================================================================
// Store Actions
// ============================================================================

export type EvaluationV3Actions = {
  // Core actions
  reset: () => void;
  setState: (state: Partial<EvaluationV3State>) => void;
  getState: () => EvaluationV3State;

  // Metadata
  setName: (name: string) => void;
  setExperimentInfo: (info: {
    experimentId?: string;
    experimentSlug?: string;
    workflowId?: string;
  }) => void;

  // Dataset actions
  setDatasetColumn: (columnId: string, updates: Partial<DatasetColumn>) => void;
  addDatasetColumn: (column: DatasetColumn) => void;
  removeDatasetColumn: (columnId: string) => void;
  setDatasetColumns: (columns: DatasetColumn[]) => void;
  reorderDatasetColumns: (fromIndex: number, toIndex: number) => void;

  setCellValue: (rowId: string, columnId: string, value: string | number | boolean | null) => void;
  addDatasetRow: () => void;
  removeDatasetRow: (rowId: string) => void;
  setDatasetRows: (rows: DatasetRow[]) => void;

  switchToSavedDataset: (datasetId: string, name: string, columns: DatasetColumn[]) => void;
  switchToInlineDataset: () => void;
  saveDatasetAs: (name: string) => Promise<void>;

  // Agent actions
  addAgent: (agent: Agent) => void;
  updateAgent: (agentId: string, updates: Partial<Agent>) => void;
  removeAgent: (agentId: string) => void;
  duplicateAgent: (agentId: string) => void;

  // Evaluator actions
  addEvaluator: (evaluator: Evaluator) => void;
  updateEvaluator: (evaluatorId: string, updates: Partial<Evaluator>) => void;
  removeEvaluator: (evaluatorId: string) => void;

  // Mapping actions
  setAgentInputMapping: (
    agentId: string,
    inputId: string,
    source: MappingSource | null
  ) => void;
  setEvaluatorInputMapping: (
    evaluatorId: string,
    agentId: string,
    inputId: string,
    source: MappingSource | null
  ) => void;
  autoMapAgent: (agentId: string) => void;
  autoMapEvaluator: (evaluatorId: string) => void;

  // Execution actions
  setCurrentRun: (run: EvaluationRun | undefined) => void;
  updateRunProgress: (progress: number, total: number) => void;
  addAgentResult: (result: EvaluationRun["agentResults"][number]) => void;
  addEvaluatorResult: (result: EvaluationRun["evaluatorResults"][number]) => void;
  setRunStatus: (status: EvaluationRun["status"], error?: string) => void;
  selectRun: (runId: string | undefined) => void;

  // UI actions
  setExpandedCell: (cell: ExpandedCell) => void;
  setActiveModal: (modal: ActiveModal) => void;
  setAutosaving: (isAutosaving: boolean) => void;
  markUnsavedChanges: (hasChanges: boolean) => void;

  // Validation helpers
  getUnmappedAgentInputs: (agentId: string) => string[];
  getUnmappedEvaluatorInputs: (evaluatorId: string) => string[];
  hasRequiredConfiguration: () => boolean;
};

export type EvaluationV3Store = EvaluationV3State & EvaluationV3Actions;

// ============================================================================
// Store Implementation
// ============================================================================

const storeCreator = (
  set: (
    partial:
      | EvaluationV3Store
      | Partial<EvaluationV3Store>
      | ((state: EvaluationV3Store) => EvaluationV3Store | Partial<EvaluationV3Store>),
    replace?: boolean
  ) => void,
  get: () => EvaluationV3Store
): EvaluationV3Store => ({
  ...INITIAL_STATE,

  // Core actions
  reset: () => set({ ...INITIAL_STATE }),

  setState: (state) => set(state),

  getState: () => {
    const state = get();
    return {
      id: state.id,
      experimentId: state.experimentId,
      experimentSlug: state.experimentSlug,
      name: state.name,
      workflowId: state.workflowId,
      dataset: state.dataset,
      agents: state.agents,
      evaluators: state.evaluators,
      agentMappings: state.agentMappings,
      evaluatorMappings: state.evaluatorMappings,
      currentRun: state.currentRun,
      runHistory: state.runHistory,
      expandedCell: state.expandedCell,
      activeModal: state.activeModal,
      selectedRunId: state.selectedRunId,
      isAutosaving: state.isAutosaving,
      hasUnsavedChanges: state.hasUnsavedChanges,
    };
  },

  // Metadata
  setName: (name) =>
    set((state) => ({ ...state, name, hasUnsavedChanges: true })),

  setExperimentInfo: (info) =>
    set((state) => ({
      ...state,
      experimentId: info.experimentId ?? state.experimentId,
      experimentSlug: info.experimentSlug ?? state.experimentSlug,
      workflowId: info.workflowId ?? state.workflowId,
    })),

  // Dataset column actions
  setDatasetColumn: (columnId, updates) =>
    set((state) => {
      if (state.dataset.type !== "inline") return state;
      return {
        ...state,
        dataset: {
          ...state.dataset,
          columns: state.dataset.columns.map((col) =>
            col.id === columnId ? { ...col, ...updates } : col
          ),
        },
        hasUnsavedChanges: true,
      };
    }),

  addDatasetColumn: (column) =>
    set((state) => {
      if (state.dataset.type !== "inline") return state;
      const newRows = state.dataset.rows.map((row) => ({
        ...row,
        values: { ...row.values, [column.id]: "" },
      }));
      return {
        ...state,
        dataset: {
          ...state.dataset,
          columns: [...state.dataset.columns, column],
          rows: newRows,
        },
        hasUnsavedChanges: true,
      };
    }),

  removeDatasetColumn: (columnId) =>
    set((state) => {
      if (state.dataset.type !== "inline") return state;
      const newRows = state.dataset.rows.map((row) => {
        const { [columnId]: _, ...rest } = row.values;
        return { ...row, values: rest };
      });
      return {
        ...state,
        dataset: {
          ...state.dataset,
          columns: state.dataset.columns.filter((col) => col.id !== columnId),
          rows: newRows,
        },
        hasUnsavedChanges: true,
      };
    }),

  setDatasetColumns: (columns: DatasetColumn[]) =>
    set((state) => {
      if (state.dataset.type !== "inline") return state;
      // Update rows to have values for all new columns
      const columnIds = new Set(columns.map((c) => c.id));
      const newRows = state.dataset.rows.map((row) => {
        const newValues: Record<string, string | number | boolean | null> = {};
        for (const col of columns) {
          newValues[col.id] = row.values[col.id] ?? "";
        }
        return { ...row, values: newValues };
      });
      return {
        ...state,
        dataset: {
          ...state.dataset,
          columns,
          rows: newRows,
        },
        hasUnsavedChanges: true,
      };
    }),

  reorderDatasetColumns: (fromIndex, toIndex) =>
    set((state) => {
      if (state.dataset.type !== "inline") return state;
      const columns = [...state.dataset.columns];
      const [removed] = columns.splice(fromIndex, 1);
      if (removed) {
        columns.splice(toIndex, 0, removed);
      }
      return {
        ...state,
        dataset: { ...state.dataset, columns },
        hasUnsavedChanges: true,
      };
    }),

  // Dataset row actions
  setCellValue: (rowId, columnId, value) =>
    set((state) => {
      if (state.dataset.type !== "inline") return state;
      return {
        ...state,
        dataset: {
          ...state.dataset,
          rows: state.dataset.rows.map((row) =>
            row.id === rowId
              ? { ...row, values: { ...row.values, [columnId]: value } }
              : row
          ),
        },
        hasUnsavedChanges: true,
      };
    }),

  addDatasetRow: () =>
    set((state) => {
      if (state.dataset.type !== "inline") return state;
      const newRow = createEmptyRow(state.dataset.columns);
      return {
        ...state,
        dataset: {
          ...state.dataset,
          rows: [...state.dataset.rows, newRow],
        },
        hasUnsavedChanges: true,
      };
    }),

  removeDatasetRow: (rowId) =>
    set((state) => {
      if (state.dataset.type !== "inline") return state;
      return {
        ...state,
        dataset: {
          ...state.dataset,
          rows: state.dataset.rows.filter((row) => row.id !== rowId),
        },
        hasUnsavedChanges: true,
      };
    }),

  setDatasetRows: (rows) =>
    set((state) => {
      if (state.dataset.type !== "inline") return state;
      return {
        ...state,
        dataset: { ...state.dataset, rows },
        hasUnsavedChanges: true,
      };
    }),

  switchToSavedDataset: (datasetId, name, columns) =>
    set((state) => ({
      ...state,
      dataset: { type: "saved", id: datasetId, name, columns },
      hasUnsavedChanges: true,
    })),

  switchToInlineDataset: () =>
    set((state) => ({
      ...state,
      dataset: {
        type: "inline",
        name: "Draft Dataset",
        columns: state.dataset.columns,
        rows: state.dataset.type === "inline"
          ? state.dataset.rows
          : [createEmptyRow(state.dataset.columns)],
      } as InlineDataset,
      hasUnsavedChanges: true,
    })),

  saveDatasetAs: async (_name) => {
    // This will be implemented to call the API
    // For now, just mark as saved
    set((state) => ({ ...state, hasUnsavedChanges: true }));
  },

  // Agent actions
  addAgent: (agent) =>
    set((state) => ({
      ...state,
      agents: [...state.agents, agent],
      agentMappings: [
        ...state.agentMappings,
        { agentId: agent.id, inputMappings: {} },
      ],
      hasUnsavedChanges: true,
    })),

  updateAgent: (agentId, updates) =>
    set((state) => ({
      ...state,
      agents: state.agents.map((agent) =>
        agent.id === agentId ? { ...agent, ...updates } as Agent : agent
      ),
      hasUnsavedChanges: true,
    })),

  removeAgent: (agentId) =>
    set((state) => ({
      ...state,
      agents: state.agents.filter((a) => a.id !== agentId),
      agentMappings: state.agentMappings.filter((m) => m.agentId !== agentId),
      // Also remove evaluator mappings for this agent
      evaluatorMappings: state.evaluatorMappings.map((em) => ({
        ...em,
        agentMappings: Object.fromEntries(
          Object.entries(em.agentMappings).filter(([id]) => id !== agentId)
        ),
      })),
      hasUnsavedChanges: true,
    })),

  duplicateAgent: (agentId) =>
    set((state) => {
      const agent = state.agents.find((a) => a.id === agentId);
      if (!agent) return state;
      const newId = `${agent.id}_copy_${Date.now()}`;
      const newAgent = { ...agent, id: newId, name: `${agent.name} (Copy)` };
      return {
        ...state,
        agents: [...state.agents, newAgent],
        agentMappings: [
          ...state.agentMappings,
          {
            agentId: newId,
            inputMappings: {
              ...(state.agentMappings.find((m) => m.agentId === agentId)
                ?.inputMappings ?? {}),
            },
          },
        ],
        hasUnsavedChanges: true,
      };
    }),

  // Evaluator actions
  addEvaluator: (evaluator) =>
    set((state) => ({
      ...state,
      evaluators: [...state.evaluators, evaluator],
      evaluatorMappings: [
        ...state.evaluatorMappings,
        { evaluatorId: evaluator.id, agentMappings: {} },
      ],
      hasUnsavedChanges: true,
    })),

  updateEvaluator: (evaluatorId, updates) =>
    set((state) => ({
      ...state,
      evaluators: state.evaluators.map((ev) =>
        ev.id === evaluatorId ? { ...ev, ...updates } : ev
      ),
      hasUnsavedChanges: true,
    })),

  removeEvaluator: (evaluatorId) =>
    set((state) => ({
      ...state,
      evaluators: state.evaluators.filter((e) => e.id !== evaluatorId),
      evaluatorMappings: state.evaluatorMappings.filter(
        (m) => m.evaluatorId !== evaluatorId
      ),
      hasUnsavedChanges: true,
    })),

  // Mapping actions
  setAgentInputMapping: (agentId, inputId, source) =>
    set((state) => ({
      ...state,
      agentMappings: state.agentMappings.map((m) =>
        m.agentId === agentId
          ? { ...m, inputMappings: { ...m.inputMappings, [inputId]: source } }
          : m
      ),
      hasUnsavedChanges: true,
    })),

  setEvaluatorInputMapping: (evaluatorId, agentId, inputId, source) =>
    set((state) => ({
      ...state,
      evaluatorMappings: state.evaluatorMappings.map((em) =>
        em.evaluatorId === evaluatorId
          ? {
              ...em,
              agentMappings: {
                ...em.agentMappings,
                [agentId]: {
                  ...(em.agentMappings[agentId] ?? {}),
                  [inputId]: source,
                },
              },
            }
          : em
      ),
      hasUnsavedChanges: true,
    })),

  autoMapAgent: (agentId) =>
    set((state) => {
      const agent = state.agents.find((a) => a.id === agentId);
      if (!agent) return state;

      const columns = state.dataset.columns;
      const newMappings: Record<string, MappingSource | null> = {};

      for (const input of agent.inputs) {
        // Try to find a matching column by name
        const matchingColumn = columns.find(
          (col) =>
            col.name.toLowerCase() === input.identifier.toLowerCase() ||
            col.id === input.identifier
        );
        if (matchingColumn) {
          newMappings[input.identifier] = {
            type: "dataset",
            columnId: matchingColumn.id,
          };
        }
      }

      return {
        ...state,
        agentMappings: state.agentMappings.map((m) =>
          m.agentId === agentId
            ? { ...m, inputMappings: { ...m.inputMappings, ...newMappings } }
            : m
        ),
        hasUnsavedChanges: true,
      };
    }),

  autoMapEvaluator: (evaluatorId) =>
    set((state) => {
      const evaluator = state.evaluators.find((e) => e.id === evaluatorId);
      if (!evaluator) return state;

      const columns = state.dataset.columns;
      const newAgentMappings: Record<string, Record<string, MappingSource | null>> = {};

      for (const agent of state.agents) {
        const agentMapping: Record<string, MappingSource | null> = {};

        for (const input of evaluator.inputs) {
          // Try to map from agent outputs first
          const matchingOutput = agent.outputs.find(
            (out) => out.identifier.toLowerCase() === input.identifier.toLowerCase()
          );
          if (matchingOutput) {
            agentMapping[input.identifier] = {
              type: "agent",
              agentId: agent.id,
              outputId: matchingOutput.identifier,
            };
            continue;
          }

          // Then try dataset columns
          const matchingColumn = columns.find(
            (col) =>
              col.name.toLowerCase() === input.identifier.toLowerCase() ||
              col.id === input.identifier
          );
          if (matchingColumn) {
            agentMapping[input.identifier] = {
              type: "dataset",
              columnId: matchingColumn.id,
            };
          }
        }

        newAgentMappings[agent.id] = agentMapping;
      }

      return {
        ...state,
        evaluatorMappings: state.evaluatorMappings.map((em) =>
          em.evaluatorId === evaluatorId
            ? { ...em, agentMappings: newAgentMappings }
            : em
        ),
        hasUnsavedChanges: true,
      };
    }),

  // Execution actions
  setCurrentRun: (run) =>
    set((state) => ({
      ...state,
      currentRun: run,
      selectedRunId: run?.id,
    })),

  updateRunProgress: (progress, total) =>
    set((state) => ({
      ...state,
      currentRun: state.currentRun
        ? { ...state.currentRun, progress, total }
        : undefined,
    })),

  addAgentResult: (result) =>
    set((state) => ({
      ...state,
      currentRun: state.currentRun
        ? {
            ...state.currentRun,
            agentResults: [...state.currentRun.agentResults, result],
          }
        : undefined,
    })),

  addEvaluatorResult: (result) =>
    set((state) => ({
      ...state,
      currentRun: state.currentRun
        ? {
            ...state.currentRun,
            evaluatorResults: [...state.currentRun.evaluatorResults, result],
          }
        : undefined,
    })),

  setRunStatus: (status, error) =>
    set((state) => ({
      ...state,
      currentRun: state.currentRun
        ? {
            ...state.currentRun,
            status,
            error,
            timestamps: {
              ...state.currentRun.timestamps,
              ...(status === "completed" || status === "error"
                ? { finishedAt: Date.now() }
                : {}),
              ...(status === "stopped" ? { stoppedAt: Date.now() } : {}),
            },
          }
        : undefined,
    })),

  selectRun: (runId) =>
    set((state) => ({ ...state, selectedRunId: runId })),

  // UI actions
  setExpandedCell: (cell) =>
    set((state) => ({ ...state, expandedCell: cell })),

  setActiveModal: (modal) =>
    set((state) => ({ ...state, activeModal: modal })),

  setAutosaving: (isAutosaving) =>
    set((state) => ({ ...state, isAutosaving })),

  markUnsavedChanges: (hasChanges) =>
    set((state) => ({ ...state, hasUnsavedChanges: hasChanges })),

  // Validation helpers
  getUnmappedAgentInputs: (agentId) => {
    const state = get();
    const agent = state.agents.find((a) => a.id === agentId);
    const mapping = state.agentMappings.find((m) => m.agentId === agentId);

    if (!agent) return [];

    return agent.inputs
      .filter((input) => !input.optional && !mapping?.inputMappings[input.identifier])
      .map((input) => input.identifier);
  },

  getUnmappedEvaluatorInputs: (evaluatorId) => {
    const state = get();
    const evaluator = state.evaluators.find((e) => e.id === evaluatorId);
    const mapping = state.evaluatorMappings.find((m) => m.evaluatorId === evaluatorId);

    if (!evaluator || state.agents.length === 0) return [];

    const unmapped: string[] = [];

    for (const input of evaluator.inputs) {
      if (input.optional) continue;

      // Check if at least one agent has this input mapped
      const hasMapping = state.agents.some((agent) => {
        const agentMapping = mapping?.agentMappings[agent.id];
        return !!agentMapping?.[input.identifier];
      });

      if (!hasMapping) {
        unmapped.push(input.identifier);
      }
    }

    return unmapped;
  },

  hasRequiredConfiguration: () => {
    const state = get();

    // Need at least one agent
    if (state.agents.length === 0) return false;

    // Need at least one evaluator
    if (state.evaluators.length === 0) return false;

    // Need at least one row
    if (state.dataset.type === "inline" && state.dataset.rows.length === 0) {
      return false;
    }

    // Check all required agent inputs are mapped
    for (const agent of state.agents) {
      const unmapped = state.getUnmappedAgentInputs(agent.id);
      if (unmapped.length > 0) return false;
    }

    // Check all required evaluator inputs are mapped
    for (const evaluator of state.evaluators) {
      const unmapped = state.getUnmappedEvaluatorInputs(evaluator.id);
      if (unmapped.length > 0) return false;
    }

    return true;
  },
});

// ============================================================================
// Create Store with Temporal (Undo/Redo)
// ============================================================================

export const useEvaluationV3Store = create<EvaluationV3Store>()(
  temporal(storeCreator, {
    handleSet: (handleSet) => {
      return debounce<typeof handleSet>(
        (pastState) => {
          handleSet(pastState);
        },
        100,
        { leading: true, trailing: false }
      );
    },
    equality: (pastState, currentState) => {
      // Only track changes to data, not UI state
      const partialize = (state: EvaluationV3Store) => ({
        name: state.name,
        dataset: state.dataset,
        agents: state.agents,
        evaluators: state.evaluators,
        agentMappings: state.agentMappings,
        evaluatorMappings: state.evaluatorMappings,
      });
      return isDeepEqual(partialize(pastState), partialize(currentState));
    },
  })
);

// Helper hooks
export const useEvaluationV3Undo = () => {
  const store = useEvaluationV3Store.temporal;
  return {
    undo: store.getState().undo,
    redo: store.getState().redo,
    canUndo: store.getState().pastStates.length > 0,
    canRedo: store.getState().futureStates.length > 0,
  };
};

