import {
  type ExpandRowPayload,
  expandRowPayloadSchema,
  type SelectPayload,
  selectPayloadSchema,
} from "../schemas";
import type { Transform } from "./types";

/** An id made of nothing addresses no trace, so it never enters a selection. */
const addressesATrace = (traceId: string): boolean => traceId.trim().length > 0;

/**
 * Replace the selection: the named traces, or every trace the search matches.
 * An empty list with `allMatching` off clears it.
 */
export const select: Transform<
  SelectPayload,
  { mode: "explicit" | "all-matching"; selected: number }
> = ({ state, payload }) => {
  const { traceIds, allMatching } = selectPayloadSchema.parse(payload);
  if (allMatching) {
    return {
      state: {
        ...state,
        selection: { mode: "all-matching", traceIds: new Set<string>() },
      },
      result: { mode: "all-matching", selected: 0 },
    };
  }
  const selected = new Set(traceIds.filter(addressesATrace));
  return {
    state: { ...state, selection: { mode: "explicit", traceIds: selected } },
    result: { mode: "explicit", selected: selected.size },
  };
};

/** Open or close one row, alone or among the rows already open. */
export const expandRow: Transform<
  ExpandRowPayload,
  { key: string; expanded: boolean }
> = ({ state, payload }) => {
  const { key, expanded, exclusive } = expandRowPayloadSchema.parse(payload);
  const open = expanded ?? !state.expandedRows.has(key);
  const next = exclusive ? new Set<string>() : new Set(state.expandedRows);
  if (open) next.add(key);
  else next.delete(key);
  return {
    state: { ...state, expandedRows: next },
    result: { key, expanded: open },
  };
};
