import { useMemo } from "react";
import { useFilterStore } from "../../traces-v2/stores/filterStore";
import {
  SELECT_ALL_MATCHING_CAP,
  useSelectionStore,
} from "../../traces-v2/stores/selectionStore";
import { ALL_MATCHING_PREFIX } from "../logic/langyChipContext";
import type { LangyContextChip } from "../stores/langyStore";

/**
 * Turns the Trace Explorer's bulk-selection (the row checkboxes) into a Langy
 * context chip — "N traces selected" — so the agent can act on exactly what the
 * user has checked instead of guessing. Reads the shared `selectionStore` that
 * the table writes to.
 *
 * Returns `null` when nothing is selected. The caller route-gates this to the
 * Trace Explorer: the selection store is a module singleton that keeps its set
 * across navigation (it only clears on filter/time/lens changes — see
 * `useResetSelectionOnViewChange`), so a stale selection must not leak a chip
 * onto unrelated pages.
 */
export function useLangySelectionContext(): LangyContextChip | null {
  const mode = useSelectionStore((s) => s.mode);
  const traceIds = useSelectionStore((s) => s.traceIds);
  // "Select all matching" is defined BY the search it matched, so the chip has
  // to carry that search or it carries nothing usable (see below).
  const queryText = useFilterStore((s) => s.queryText);

  return useMemo(
    () => selectionContextChip({ mode, traceIds, queryText }),
    [mode, traceIds, queryText],
  );
}

/**
 * Build the selection chip from the selection store's shape. Pure so it can be
 * unit-tested. The id encodes the exact selection (sorted so order doesn't
 * matter) so a dismissed chip re-surfaces the moment the user's selection
 * changes to a different set.
 */
export function selectionContextChip({
  mode,
  traceIds,
  queryText = "",
}: {
  mode: "explicit" | "all-matching";
  traceIds: Set<string>;
  /** The Trace Explorer's active search, which is what "all matching" means. */
  queryText?: string;
}): LangyContextChip | null {
  if (mode === "all-matching") {
    const query = queryText.trim();
    return {
      // Keyed on the search, so changing the search re-surfaces a dismissed
      // chip: "everything matching X" and "everything matching Y" are not the
      // same context.
      id: `selection:all-matching:${query}`,
      kind: "selection",
      label: `all matching traces selected (max ${SELECT_ALL_MATCHING_CAP.toLocaleString()})`,
      // This used to be the literal string "all-matching", which told the agent
      // precisely nothing: it named the MODE the user was in rather than the
      // traces they meant. There can be ten thousand of them, so the honest
      // payload is not a row list, it is the SEARCH they all matched, which the
      // agent can run for itself.
      ref: `${ALL_MATCHING_PREFIX}${query}`,
    };
  }

  const ids = [...traceIds];
  if (ids.length === 0) return null;

  const sorted = [...ids].sort();
  const joined = sorted.join(",");

  if (sorted.length === 1) {
    const only = sorted[0]!;
    return {
      id: `selection:${joined}`,
      kind: "selection",
      label: `1 trace selected: ${shortenId(only)}`,
      ref: only,
    };
  }

  return {
    id: `selection:${joined}`,
    kind: "selection",
    label: `${sorted.length} traces selected`,
    // Forward the concrete ids so the agent can resolve "these traces".
    ref: joined,
  };
}

/** Shorten a long id for a chip label: `3f9a01…c2`. */
function shortenId(id: string): string {
  if (id.length <= 10) return id;
  return `${id.slice(0, 6)}…${id.slice(-2)}`;
}
