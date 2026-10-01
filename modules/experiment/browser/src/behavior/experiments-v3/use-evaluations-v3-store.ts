import {
  isWorkbenchActionKind,
  WORKBENCH_ACTIONS,
  type WorkbenchActionDefinition,
  addColumn as addColumnTransform,
  assertComparisonColumnAllowed,
  attachEvaluator,
  attachTarget,
  duplicateTarget as duplicateTargetTransform,
  isTransformError,
  removeTarget as removeTargetTransform,
  setCellValue as setCellValueTransform,
  setEvaluatorMapping as setEvaluatorMappingTransform,
  setTargetMapping as setTargetMappingTransform,
  setTargetPrompt as setTargetPromptTransform,
  type Transform,
  type WorkbenchState,
} from "@langwatch/experiment-contract";
import isDeepEqual from "fast-deep-equal";
import debounce from "lodash-es/debounce";
import { temporal } from "zundo";
import { create, type StateCreator, type StoreApi } from "zustand";

import {
  createInitialState,
  type EvaluationsV3Actions,
  type EvaluationsV3State,
  type EvaluationsV3Store,
  type EvaluatorConfig,
  type TargetConfig,
} from "../../model/experiments-v3/types.ts";
import {
  datasetCellValue,
  datasetRowCount,
  withInlineColumnEdit,
  withoutInlineColumn,
  withoutPendingChange,
  withoutSelectedRows,
  withSavedRecordEdit,
} from "../../model/experiments-v3/workbench-dataset-edits.ts";
import { loadedWorkbenchState } from "../../model/experiments-v3/workbench-loaded-state.ts";
import {
  withNewDatasetMappings,
  withTargetComparison,
  withTargetUpdate,
} from "../../model/experiments-v3/workbench-target-edits.ts";

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Remove all mappings for a specific dataset from targets and evaluators.
 * With the new per-dataset structure, we simply delete the dataset key from mappings.
 */
const removeMappingsForDataset = (
  state: EvaluationsV3State,
  datasetId: string,
): { targets: TargetConfig[]; evaluators: EvaluatorConfig[] } => {
  // Remove dataset mappings from targets (delete the dataset key)
  const targets = state.targets.map((target) => {
    const newMappings = { ...target.mappings };
    delete newMappings[datasetId];
    return { ...target, mappings: newMappings };
  });

  // Remove dataset mappings from evaluators (delete the dataset key)
  const evaluators = state.evaluators.map((evaluator) => {
    const newMappings = { ...evaluator.mappings };
    delete newMappings[datasetId];
    return { ...evaluator, mappings: newMappings };
  });

  return { targets, evaluators };
};

/**
 * The persisted slice a transform reads. Excludes results and UI state, which
 * no transform is allowed to see.
 */
const workbenchStateOf = (state: EvaluationsV3State): WorkbenchState => ({
  name: state.name,
  datasets: state.datasets,
  activeDatasetId: state.activeDatasetId,
  evaluators: state.evaluators,
  targets: state.targets,
  experimentId: state.experimentId,
  experimentSlug: state.experimentSlug,
});

/** What zustand merges back after a transform ran. */
const sliceOf = (next: WorkbenchState): PartializedState => ({
  name: next.name,
  datasets: next.datasets,
  activeDatasetId: next.activeDatasetId,
  evaluators: next.evaluators,
  targets: next.targets,
});

/**
 * Run a pure transform over the current state and hand zustand the slice to merge back.
 */
const runTransform = <Payload, Result>({
  state,
  transform,
  payload,
}: {
  state: EvaluationsV3State;
  transform: Transform<Payload, Result>;
  payload: Payload;
}): { slice: PartializedState; result?: Result } => {
  const { state: next, result } = transform({
    state: workbenchStateOf(state),
    payload,
  });
  return { slice: sliceOf(next), result };
};

/**
 * Same, for the actions whose store contract is "invalid input changes
 * nothing". A transform refuses with a typed error so an agent gets told why;
 * the store keeps its silent no-op.
 */
const runTransformOrKeep = <Payload, Result>(args: {
  state: EvaluationsV3State;
  transform: Transform<Payload, Result>;
  payload: Payload;
}): PartializedState | null => {
  try {
    return runTransform(args).slice;
  } catch (error) {
    if (isTransformError(error)) return null;
    throw error;
  }
};

/**
 * The same swallow for a store action that holds an invariant itself instead of
 * through a transform: run the edit, and keep the state untouched when the edit
 * refuses. Only a refusal is swallowed, so a genuine bug still surfaces.
 */
const editOrKeep = <Slice>(edit: () => Slice, keep: Slice): Slice => {
  try {
    return edit();
  } catch (error) {
    if (isTransformError(error)) return keep;
    throw error;
  }
};

// ============================================================================
// Store Implementation
// ============================================================================

type StoreSet = StoreApi<EvaluationsV3Store>["setState"];
type StoreGet = StoreApi<EvaluationsV3Store>["getState"];

/** Metadata actions. */
type MetadataActions = Pick<
  EvaluationsV3Actions,
  | "setName"
  | "setExperimentId"
  | "setExperimentSlug"
  | "setWorkbenchVersion"
  | "setStaleWorkbench"
  | "rememberRunStartedHere"
>;

const metadataSlice = (set: StoreSet): MetadataActions => ({
  setName: (name) => {
    set({ name });
  },

  setExperimentId: (experimentId) => {
    set({ experimentId });
  },

  setExperimentSlug: (experimentSlug) => {
    set({ experimentSlug });
  },

  setWorkbenchVersion: (workbenchVersion) => {
    set({ workbenchVersion });
  },

  setStaleWorkbench: (staleWorkbench) => {
    set({ staleWorkbench });
  },

  rememberRunStartedHere: (runId) => {
    set((state) => {
      const known = state.runsStartedHere ?? [];
      return known.includes(runId) ? {} : { runsStartedHere: [...known, runId] };
    });
  },
});

/** Dataset management actions. */
type DatasetManagementActions = Pick<EvaluationsV3Actions, "addDataset" | "removeDataset">;

const datasetManagementSlice = (set: StoreSet, get: StoreGet): DatasetManagementActions => ({
  addDataset: (dataset) => {
    set((state) => ({ datasets: [...state.datasets, dataset] }));
    // Auto-map every target and evaluator onto the new dataset, carrying each
    // existing mapping across by column name.
    const state = get();
    const mapped = withNewDatasetMappings({ state, dataset });
    if (mapped.targets !== state.targets || mapped.evaluators !== state.evaluators) set(mapped);
  },

  removeDataset: (datasetId) => {
    set((state) => {
      // Can't remove the last dataset
      if (state.datasets.length <= 1) return state;

      // Remove the dataset
      const newDatasets = state.datasets.filter((d) => d.id !== datasetId);

      // If removing the active dataset, switch to first available
      const newActiveDatasetId =
        state.activeDatasetId === datasetId ? newDatasets[0]!.id : state.activeDatasetId;

      // Clean up mappings pointing to this dataset
      const { targets, evaluators } = removeMappingsForDataset(state, datasetId);

      return {
        datasets: newDatasets,
        activeDatasetId: newActiveDatasetId,
        targets,
        evaluators,
      };
    });
  },
});

/** Active dataset and dataset edit actions. */
type DatasetSelectionActions = Pick<
  EvaluationsV3Actions,
  "setActiveDataset" | "updateDataset" | "exportInlineToSaved"
>;

const datasetSelectionSlice = (set: StoreSet): DatasetSelectionActions => ({
  setActiveDataset: (datasetId) => {
    set((state) => {
      // Verify dataset exists
      if (!state.datasets.find((d) => d.id === datasetId)) return state;
      return { activeDatasetId: datasetId };
    });
  },

  updateDataset: (datasetId, updates) => {
    set((state) => ({
      datasets: state.datasets.map((d) => (d.id === datasetId ? { ...d, ...updates } : d)),
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
          : d,
      ),
    }));
  },
});

/** Inline dataset cell/column actions (scoped to a dataset). */
type DatasetCellsActions = Pick<
  EvaluationsV3Actions,
  | "setCellValue"
  | "addColumn"
  | "removeColumn"
  | "renameColumn"
  | "updateColumnType"
  | "getRowCount"
  | "getCellValue"
>;

const datasetCellsSlice = (set: StoreSet, get: StoreGet): DatasetCellsActions => ({
  setCellValue: ({ datasetId, row, columnId, value }) => {
    const dataset = get().datasets.find((d) => d.id === datasetId);
    if (!dataset) return;

    // For saved datasets, use updateSavedRecordValue
    if (dataset.type === "saved") {
      get().updateSavedRecordValue({ datasetId, rowIndex: row, columnId, value });
      return;
    }

    // For inline datasets, update local records
    if (dataset.type === "inline" && dataset.inline) {
      set(
        (state) =>
          runTransformOrKeep({
            state,
            transform: setCellValueTransform,
            payload: { datasetId, rowIndex: row, columnId, value },
          }) ?? state,
      );
    }
  },

  addColumn: (datasetId, column) => {
    set(
      (state) =>
        runTransformOrKeep({
          state,
          transform: addColumnTransform,
          payload: { datasetId, column },
        }) ?? state,
    );
  },

  removeColumn: (datasetId, columnId) => {
    set((state) => withoutInlineColumn({ state, datasetId, columnId }));
  },

  renameColumn: (datasetId, columnId, newName) => {
    set((state) =>
      withInlineColumnEdit({ state, datasetId, columnId, edit: (c) => ({ ...c, name: newName }) }),
    );
  },

  updateColumnType: (datasetId, columnId, type) => {
    set((state) =>
      withInlineColumnEdit({ state, datasetId, columnId, edit: (c) => ({ ...c, type }) }),
    );
  },

  getRowCount: (datasetId) => datasetRowCount(get().datasets.find((d) => d.id === datasetId)),

  getCellValue: (datasetId, row, columnId) =>
    datasetCellValue({ dataset: get().datasets.find((d) => d.id === datasetId), row, columnId }),
});

/** Saved dataset record actions. */
type SavedRecordActions = Pick<
  EvaluationsV3Actions,
  "updateSavedRecordValue" | "clearPendingChange" | "getSavedRecordInfo"
>;

const savedRecordsSlice = (set: StoreSet, get: StoreGet): SavedRecordActions => ({
  updateSavedRecordValue: (edit) => {
    set((state) => withSavedRecordEdit({ state, ...edit }));
  },

  clearPendingChange: (dbDatasetId, recordId) => {
    set((state) => ({
      pendingSavedChanges: withoutPendingChange({
        pending: state.pendingSavedChanges,
        dbDatasetId,
        recordId,
      }),
    }));
  },

  getSavedRecordInfo: (datasetId, rowIndex) => {
    const state = get();
    const dataset = state.datasets.find((d) => d.id === datasetId);
    if (dataset?.type !== "saved" || !dataset.savedRecords || !dataset.datasetId) {
      return null;
    }

    const record = dataset.savedRecords[rowIndex];
    if (!record) return null;

    return {
      dbDatasetId: dataset.datasetId,
      recordId: record.id,
    };
  },
});

/** Target actions. */
type TargetsActions = Pick<
  EvaluationsV3Actions,
  "addTarget" | "applyWorkbenchAction" | "duplicateTarget" | "updateTarget" | "removeTarget"
>;

const targetsSlice = (set: StoreSet): TargetsActions => ({
  addTarget: (target) => {
    // Calls the transform's core rather than the transform itself: the store's
    // callers hand over an already-typed TargetConfig, so re-parsing it against
    // the action payload schema would reject shapes the UI has always accepted.
    // The wiring — auto-mapping the target and every evaluator onto it — is the
    // same code either way.
    set((state) =>
      sliceOf(
        attachTarget({
          state: workbenchStateOf(state),
          target: {
            ...target,
            // Defensive: callers have shipped targets without these.
            inputs: target.inputs ?? [],
            outputs: target.outputs ?? [],
          },
        }),
      ),
    );
  },

  applyWorkbenchAction: ({ kind, payload }) => {
    // Widened to the definition type: the per-kind union makes `transform`
    // inaccessible because the read/run kinds don't carry one.
    const definition: WorkbenchActionDefinition | undefined = isWorkbenchActionKind(kind)
      ? WORKBENCH_ACTIONS[kind]
      : undefined;
    const transform = definition?.transform;
    if (!definition || !transform) {
      throw new Error(`No transform-backed workbench action "${kind}"`);
    }
    const parsed: unknown = definition.payloadSchema.parse(payload);
    let result: unknown;
    set((state) => {
      const applied = runTransform({
        state,
        transform: transform as Transform<unknown, unknown>,
        payload: parsed,
      });
      result = applied.result;
      return applied.slice;
    });
    return result;
  },

  duplicateTarget: ({ targetId, name }) => {
    let duplicatedId: string | undefined;
    set((state) => {
      try {
        const { slice, result } = runTransform({
          state,
          transform: duplicateTargetTransform,
          payload: { targetId, name },
        });
        duplicatedId = result?.targetId;
        return slice;
      } catch (error) {
        // An unknown target changes nothing, and the caller reads that from
        // the undefined id rather than from an exception.
        if (isTransformError(error)) return state;
        throw error;
      }
    });
    return duplicatedId;
  },

  updateTarget: (targetId, updates) => {
    set((state) => withTargetUpdate({ state, targetId, updates }));
  },

  removeTarget: (targetId) => {
    set(
      (state) =>
        runTransform({
          state,
          transform: removeTargetTransform,
          payload: { targetId },
        }).slice,
    );
  },
});

/** Target prompt, comparison and mapping actions. */
type TargetConfigActions = Pick<
  EvaluationsV3Actions,
  "setTargetPrompt" | "updateTargetComparison" | "setTargetMapping" | "removeTargetMapping"
>;

const targetConfigSlice = (set: StoreSet): TargetConfigActions => ({
  setTargetPrompt: (payload) => {
    set(
      (state) =>
        runTransformOrKeep({
          state,
          transform: setTargetPromptTransform,
          payload,
        }) ?? state,
    );
  },

  updateTargetComparison: (targetId, comparison) => {
    set((state) => withTargetComparison({ state, targetId, comparison }));
  },

  setTargetMapping: ({ targetId, datasetId, inputField, mapping }) => {
    set(
      (state) =>
        runTransformOrKeep({
          state,
          transform: setTargetMappingTransform,
          payload: { targetId, datasetId, inputField, mapping },
        }) ?? state,
    );
  },

  removeTargetMapping: (targetId, datasetId, inputField) => {
    set((state) => ({
      targets: state.targets.map((r) => {
        if (r.id !== targetId) return r;
        const datasetMappings = { ...r.mappings[datasetId] };
        delete datasetMappings[inputField];
        return {
          ...r,
          mappings: {
            ...r.mappings,
            [datasetId]: datasetMappings,
          },
        };
      }),
    }));
  },
});

/** Global evaluator actions. */
type EvaluatorsActions = Pick<
  EvaluationsV3Actions,
  "addEvaluator" | "updateEvaluator" | "removeEvaluator"
>;

const evaluatorsSlice = (set: StoreSet): EvaluatorsActions => ({
  addEvaluator: (evaluator) => {
    // The transform's core, for the same reason as addTarget: the caller's
    // EvaluatorConfig is already typed, and the auto-mapping is shared.
    set((state) =>
      editOrKeep<PartializedState | EvaluationsV3State>(
        () => sliceOf(attachEvaluator({ state: workbenchStateOf(state), evaluator })),
        state,
      ),
    );
  },

  /**
   * A shallow merge, refused when the result would be an evaluator that cannot be what
   * it now claims to be.
   */
  updateEvaluator: (evaluatorId, updates) => {
    set((state) =>
      editOrKeep<Pick<EvaluationsV3State, "evaluators"> | EvaluationsV3State>(
        () => ({
          evaluators: state.evaluators.map((e) => {
            if (e.id !== evaluatorId) return e;
            const merged = { ...e, ...updates };
            assertComparisonColumnAllowed(merged);
            return merged;
          }),
        }),
        state,
      ),
    );
  },

  removeEvaluator: (evaluatorId) => {
    set((state) => ({
      evaluators: state.evaluators.filter((e) => e.id !== evaluatorId),
    }));
  },
});

/** Evaluator mapping actions (per-dataset, per-target mappings stored inside evaluator). */
type EvaluatorMappingsActions = Pick<
  EvaluationsV3Actions,
  "setEvaluatorMapping" | "removeEvaluatorMapping"
>;

const evaluatorMappingsSlice = (set: StoreSet): EvaluatorMappingsActions => ({
  setEvaluatorMapping: ({ evaluatorId, datasetId, targetId, inputField, mapping }) => {
    set(
      (state) =>
        runTransformOrKeep({
          state,
          transform: setEvaluatorMappingTransform,
          payload: { evaluatorId, datasetId, targetId, inputField, mapping },
        }) ?? state,
    );
  },

  removeEvaluatorMapping: ({ evaluatorId, datasetId, targetId, inputField }) => {
    set((state) => ({
      evaluators: state.evaluators.map((e) => {
        if (e.id !== evaluatorId) return e;
        const datasetMappings = { ...e.mappings[datasetId] };
        const targetMappings = { ...datasetMappings[targetId] };
        delete targetMappings[inputField];
        datasetMappings[targetId] = targetMappings;
        return {
          ...e,
          mappings: {
            ...e.mappings,
            [datasetId]: datasetMappings,
          },
        };
      }),
    }));
  },
});

/** Results actions. */
type ResultsActions = Pick<EvaluationsV3Actions, "setResults" | "clearResults">;

const resultsSlice = (set: StoreSet): ResultsActions => ({
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
        targetOutputs: {},
        targetMetadata: {},
        evaluatorResults: {},
        errors: {},
        executingCells: undefined,
        runningEvaluators: undefined,
      },
    });
  },
});

/** UI actions. */
type UiActions = Pick<
  EvaluationsV3Actions,
  | "openOverlay"
  | "closeOverlay"
  | "setSelectedCell"
  | "setEditingCell"
  | "setHighlightedVariantTargetId"
  | "toggleRowSelection"
  | "selectAllRows"
  | "clearRowSelection"
  | "deleteSelectedRows"
>;

const uiSlice = (set: StoreSet, get: StoreGet): UiActions => ({
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

  setHighlightedVariantTargetId: (targetId, outcome) => {
    set({
      ui: {
        ...get().ui,
        highlightedVariantTargetId: targetId,
        highlightedVariantOutcome: targetId ? outcome : undefined,
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
    const selectedRows = get().ui.selectedRows;
    if (selectedRows.size === 0) return;
    set((state) => withoutSelectedRows({ state, datasetId, rows: selectedRows }));
  },
});

/** Column, row and panel layout actions. */
type UiLayoutActions = Pick<
  EvaluationsV3Actions,
  | "setExpandedEvaluator"
  | "setColumnWidth"
  | "setColumnWidths"
  | "setRowHeightMode"
  | "setConcurrency"
  | "toggleCellExpanded"
  | "toggleColumnVisibility"
  | "setHiddenColumns"
  | "setAutosaveStatus"
>;

const uiLayoutSlice = (set: StoreSet): UiLayoutActions => ({
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

  setConcurrency: (concurrency) => {
    set((state) => ({
      ui: {
        ...state.ui,
        concurrency,
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
});

/** Reset. */
type ResetActions = Pick<EvaluationsV3Actions, "reset" | "loadState" | "setSavedDatasetRecords">;

const resetSlice = (set: StoreSet): ResetActions => ({
  reset: () => {
    // IMPORTANT: Explicitly clear experimentId and experimentSlug
    // createInitialState() doesn't include these optional fields,
    // and Zustand's set() does a shallow merge, so we need to explicitly set them
    set({
      ...createInitialState(),
      experimentId: undefined,
      experimentSlug: undefined,
      workbenchVersion: undefined,
      staleWorkbench: undefined,
    });
  },

  loadState: (workbenchState: unknown) => {
    if (!workbenchState || typeof workbenchState !== "object") return;
    set((current) => loadedWorkbenchState({ current, persisted: workbenchState }));
    // Clear undo/redo history so an undo cannot return to the pre-load state.
    useEvaluationsV3Store.temporal.getState().clear();
  },

  setSavedDatasetRecords: (datasetId: string, records) => {
    set((state) => ({
      datasets: state.datasets.map((d) =>
        d.id === datasetId && d.type === "saved" ? { ...d, savedRecords: records } : d,
      ),
    }));
  },
});

const storeImpl: StateCreator<EvaluationsV3Store> = (set, get) => ({
  ...createInitialState(),
  ...metadataSlice(set),
  ...datasetManagementSlice(set, get),
  ...datasetSelectionSlice(set),
  ...datasetCellsSlice(set, get),
  ...savedRecordsSlice(set, get),
  ...targetsSlice(set),
  ...targetConfigSlice(set),
  ...evaluatorsSlice(set),
  ...evaluatorMappingsSlice(set),
  ...resultsSlice(set),
  ...uiSlice(set, get),
  ...uiLayoutSlice(set),
  ...resetSlice(set),
});

// ============================================================================
// Temporal (Undo/Redo) Configuration
// ============================================================================

/**
 * State subset used for equality comparison to determine if a new history entry should
 * be created.
 */
type PartializedState = Pick<
  EvaluationsV3State,
  "name" | "datasets" | "activeDatasetId" | "evaluators" | "targets"
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
  targets: state.targets,
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
        { leading: true, trailing: false },
      );
    },
    equality: (pastState, currentState) => {
      return isDeepEqual(
        partializeState(pastState as EvaluationsV3Store),
        partializeState(currentState as EvaluationsV3Store),
      );
    },
  }),
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
