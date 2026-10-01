import { defineSlice } from "@langwatch/browser-host/global-store";
import {
  TRACE_EXPLORER_SCOPE_SLICE,
  type TraceExplorerScopeState,
} from "@langwatch/trace-contract";

import { lensKeepsTheResultSet } from "./explorer-link-lens.ts";
import { type ExplorerStore, useExplorerStore } from "./explorer.store.ts";
import { traceViewContextChip } from "./view-context-chip.ts";

function scopeOf(state: ExplorerStore): TraceExplorerScopeState {
  const lens = state.allLenses.find((l) => l.id === state.activeLensId);
  return {
    queryText: state.queryText,
    selectionMode: state.selection.mode,
    selectedTraceIds: state.selection.traceIds,
    viewChip: traceViewContextChip({
      source: "traces",
      queryText: state.queryText,
      timeRange: state.timeRange,
      lens: lens
        ? {
            id: state.activeLensId,
            name: lens.name,
            isSavedView: !lens.isBuiltIn,
            hasLocalChanges: state.draftState.has(state.activeLensId),
          }
        : void 0,
      grouping: state.grouping,
      sort: state.sort,
    }),
    linkLensId: lensKeepsTheResultSet(lens) ? state.activeLensId : void 0,
  };
}

function inputsOf(state: ExplorerStore): unknown[] {
  return [
    state.queryText,
    state.timeRange,
    state.activeLensId,
    state.allLenses,
    state.draftState,
    state.grouping,
    state.sort,
    state.selection,
  ];
}

/**
 * What the Explorer publishes for other modules (`trace:explorer-scope`): its search, selection,
 * the view as one chip, and the lens a link should open. Derived from the Explorer store, so
 * Langy reads facts rather than the store's shape.
 */
export const useTraceExplorerScope = defineSlice<TraceExplorerScopeState>({
  name: TRACE_EXPLORER_SCOPE_SLICE,
  create: () => scopeOf(useExplorerStore.getState()),
});

useExplorerStore.subscribe((state, previous) => {
  const next = inputsOf(state);
  const before = inputsOf(previous);
  if (next.every((value, index) => Object.is(value, before[index]))) return;
  useTraceExplorerScope.setState(scopeOf(state));
});
