import type { ColumnDef } from "@tanstack/react-table";
import { useMemo } from "react";
import { useDensityStore } from "../../stores/densityStore";
import type { TraceListItem } from "../../types/trace";
import { buildTraceColumns } from "./columns";
import { expandTraceColumns, type Registry, traceRegistry } from "./registry";
import { traceCells } from "./registry/cells/trace";
import { traceSelectColumnDef } from "./selectColumn";

const COMPACT_MIN_WIDTH_PX = 1500;
const COMFORTABLE_FALLBACK_MIN_SIZE_PX = 100;

interface TraceLensColumns {
  columns: Array<ColumnDef<TraceListItem, any>>;
  registry: Registry<TraceListItem>;
  minWidth: string;
}

export function useTraceLensColumns({
  logicalColumnIds,
  traces,
}: {
  logicalColumnIds: string[];
  traces: TraceListItem[];
}): TraceLensColumns {
  const density = useDensityStore((s) => s.density);

  const expanded = useMemo(
    () =>
      density === "comfortable"
        ? expandTraceColumns(logicalColumnIds, traces, traceCells)
        : null,
    [density, logicalColumnIds, traces],
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
