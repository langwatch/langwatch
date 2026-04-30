import type { ColumnDef } from "@tanstack/react-table";
import { useMemo, useRef } from "react";
import { useDensityStore } from "../../stores/densityStore";
import type { TraceListItem } from "../../types/trace";
import { buildTraceColumns } from "./columns";
import { expandTraceColumns, type Registry, traceRegistry } from "./registry";
import { traceCells } from "./registry/cells/trace";
import { uniqueEvaluators } from "./registry/cells/trace/dynamicEvalCell";
import { uniqueEventNames } from "./registry/cells/trace/dynamicEventCell";
import { traceSelectColumnDef } from "./selectColumn";

const COMFORTABLE_FALLBACK_MIN_SIZE_PX = 100;
const SELECT_COL_MIN_PX = 32;
/**
 * Floor for the compact-density min table width. We were pinning a flat
 * 1500px floor here, which forced horizontal scroll whenever the facet
 * sidebar opened on a typical laptop viewport — and within that 1500px
 * the flex Trace column was stuck at the leftover slice (often ~300px)
 * regardless of how much real estate was free. Computing the floor from
 * the visible columns' minSize lets the table fit the viewport when it
 * can, and the Trace column absorbs the slack as the sidebar collapses /
 * expands instead of being capped.
 */
const COMPACT_MIN_WIDTH_FLOOR_PX = 800;

interface TraceLensColumns {
  columns: Array<ColumnDef<TraceListItem, any>>;
  registry: Registry<TraceListItem>;
  minWidth: string;
}

/**
 * The shape of the comfortable-density column set is derived from the
 * traces — but only from the *set of evaluator keys, set of event names,
 * and presence of any error*. Encoding those as a single string lets us
 * recompute columns only when the shape actually changes, instead of on
 * every SSE-driven traces refresh.
 */
function computeColumnSignature(traces: TraceListItem[]): string {
  const evals = uniqueEvaluators(traces)
    .map((k) => `${k.evaluatorId}:${k.evaluatorName ?? ""}`)
    .sort()
    .join("|");
  const events = uniqueEventNames(traces).slice().sort().join("|");
  const hasError = traces.some((t) => Boolean(t.error)) ? "1" : "0";
  return `${hasError}#${evals}#${events}`;
}

export function useTraceLensColumns({
  logicalColumnIds,
  traces,
}: {
  logicalColumnIds: string[];
  traces: TraceListItem[];
}): TraceLensColumns {
  const density = useDensityStore((s) => s.density);

  // expandTraceColumns walks the traces to build dynamic eval/event columns,
  // but its output only changes when the column-shape signature changes.
  // We pin traces to a ref so the memo can read the freshest data while
  // depending only on the signature.
  const tracesRef = useRef(traces);
  tracesRef.current = traces;
  const colSignature = useMemo(() => computeColumnSignature(traces), [traces]);

  const expanded = useMemo(
    () =>
      density === "comfortable"
        ? expandTraceColumns(logicalColumnIds, tracesRef.current, traceCells)
        : null,
    [density, logicalColumnIds, colSignature],
  );

  const columns = useMemo(() => {
    const dataColumns = expanded
      ? expanded.map((e) => e.columnDef)
      : buildTraceColumns(logicalColumnIds);
    return [traceSelectColumnDef, ...dataColumns];
  }, [expanded, logicalColumnIds]);

  const registry = useMemo<Registry<TraceListItem>>(() => {
    if (!expanded) return traceRegistry;
    const dynamicCells = Object.fromEntries(
      expanded.map((e) => [e.id, e.cellDef]),
    );
    return {
      rowKind: "trace",
      cells: { ...traceRegistry.cells, ...dynamicCells },
      addons: traceRegistry.addons,
    };
  }, [expanded]);

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
    const widthFor = (
      def: { size?: number; minSize?: number; meta?: unknown },
    ): number => {
      const isFlex = (def.meta as { flex?: boolean } | undefined)?.flex;
      // The flex column declares an absurd `size` (e.g. 9999) as its
      // appetite-for-leftover signal. Use its minSize as the floor instead.
      if (isFlex) return def.minSize ?? COMFORTABLE_FALLBACK_MIN_SIZE_PX;
      return def.size ?? def.minSize ?? COMFORTABLE_FALLBACK_MIN_SIZE_PX;
    };

    if (!expanded) {
      const cols = buildTraceColumns(logicalColumnIds);
      const total = cols.reduce(
        (sum, c) =>
          sum +
          widthFor(
            c as { size?: number; minSize?: number; meta?: unknown },
          ),
        SELECT_COL_MIN_PX,
      );
      return `${Math.max(total, COMPACT_MIN_WIDTH_FLOOR_PX)}px`;
    }
    const total = expanded.reduce(
      (sum, e) =>
        sum +
        widthFor(
          e.columnDef as { size?: number; minSize?: number; meta?: unknown },
        ),
      SELECT_COL_MIN_PX,
    );
    return `${Math.max(total, COMPACT_MIN_WIDTH_FLOOR_PX)}px`;
  }, [expanded, logicalColumnIds]);

  return { columns, registry, minWidth };
}
