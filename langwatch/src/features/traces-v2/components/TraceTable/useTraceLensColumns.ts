import type { ColumnDef } from "@tanstack/react-table";
import { useMemo } from "react";
import type { TraceListItem } from "../../types/trace";
import { buildTraceColumns } from "./columns";
import { traceRegistry, type Registry } from "./registry";
import { traceSelectColumnDef } from "./selectColumn";

const SELECT_COL_MIN_PX = 32;
/**
 * Floor for the trace-lens min table width. We were pinning a flat 1500px
 * floor here, which forced horizontal scroll whenever the facet sidebar
 * opened on a typical laptop viewport — and within that 1500px the flex
 * Trace column was stuck at the leftover slice (often ~300px) regardless
 * of how much real estate was free. Computing the floor from the visible
 * columns' minSize lets the table fit the viewport when it can, and the
 * Trace column absorbs the slack as the sidebar collapses / expands
 * instead of being capped.
 */
const MIN_WIDTH_FLOOR_PX = 800;
const FALLBACK_COL_MIN_SIZE_PX = 100;

interface TraceLensColumns {
  columns: Array<ColumnDef<TraceListItem, any>>;
  registry: Registry<TraceListItem>;
  minWidth: string;
}

export function useTraceLensColumns({
  logicalColumnIds,
}: {
  logicalColumnIds: string[];
}): TraceLensColumns {
  const columns = useMemo(
    () => [traceSelectColumnDef, ...buildTraceColumns(logicalColumnIds)],
    [logicalColumnIds],
  );

  const minWidth = useMemo(() => {
    /**
     * Floor the table at "every fixed column at its declared size + every
     * flex column at its minSize + the select gutter." Earlier we used
     * minSize across the board, but that produced a floor *below* what
     * fixed columns actually claim at render time — `tableLayout: fixed`
     * gave each fixed col its declared `size`, the flex col absorbed the
     * deficit, and on narrow viewports the deficit went negative: the
     * trace column collapsed to ~0px and its content visually bled into
     * the next column. Floor-by-declared-size keeps the trace col at
     * least at its minSize while letting it absorb extra space when the
     * viewport is wider than the floor (sidebar collapsed = wider viewport
     * = wider trace col).
     */
    const widthFor = (def: {
      size?: number;
      minSize?: number;
      meta?: unknown;
    }): number => {
      const isFlex = (def.meta as { flex?: boolean } | undefined)?.flex;
      if (isFlex) return def.minSize ?? FALLBACK_COL_MIN_SIZE_PX;
      return def.size ?? def.minSize ?? FALLBACK_COL_MIN_SIZE_PX;
    };

    const cols = buildTraceColumns(logicalColumnIds);
    const total = cols.reduce(
      (sum, c) =>
        sum +
        widthFor(c as { size?: number; minSize?: number; meta?: unknown }),
      SELECT_COL_MIN_PX,
    );
    return `${Math.max(total, MIN_WIDTH_FLOOR_PX)}px`;
  }, [logicalColumnIds]);

  return { columns, registry: traceRegistry, minWidth };
}
