import { readSlice } from "@langwatch/browser-host/global-store";
import {
  RUN_HISTORY_ABSENT,
  RUN_HISTORY_SLICE,
  type RunHistoryState,
} from "@langwatch/suite-contract";

export type { RunHistoryState, ViewMode } from "@langwatch/suite-contract";

/** The run-history view state, read from the global UI store (`suite:run-history`). */
export const useRunHistoryStore = readSlice<RunHistoryState>({
  name: RUN_HISTORY_SLICE,
  absent: RUN_HISTORY_ABSENT,
});
