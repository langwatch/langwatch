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

const COMPACT_MIN_WIDTH_PX = 1500;
const COMFORTABLE_FALLBACK_MIN_SIZE_PX = 100;

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
    if (!expanded) return `${COMPACT_MIN_WIDTH_PX}px`;
    const total = expanded.reduce(
      (sum, e) =>
        sum +
        ((e.columnDef as { minSize?: number }).minSize ??
          COMFORTABLE_FALLBACK_MIN_SIZE_PX),
      0,
    );
    return `${Math.max(total, COMPACT_MIN_WIDTH_PX)}px`;
  }, [expanded]);

  return { columns, registry, minWidth };
}
