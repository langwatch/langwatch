import { readSlice } from "@langwatch/browser-host/global-store";
import {
  TRACE_EXPLORER_SCOPE_ABSENT,
  TRACE_EXPLORER_SCOPE_SLICE,
  type TraceExplorerScopeState,
} from "@langwatch/trace-contract";

/** The Trace Explorer's search, selection and view, read from `trace:explorer-scope`. */
export const useTraceExplorerScope = readSlice<TraceExplorerScopeState>({
  name: TRACE_EXPLORER_SCOPE_SLICE,
  absent: TRACE_EXPLORER_SCOPE_ABSENT,
});
