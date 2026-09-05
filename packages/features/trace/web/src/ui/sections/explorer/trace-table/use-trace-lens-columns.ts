import type { ColumnDef } from "@tanstack/react-table";
import { useMemo } from "react";
import { parseEvalColumnId, timeColumnSizing, useTimeFormatStore } from "../../../../index";
import type { TraceListItem } from "../types/trace";
import { addColumnColumnDef } from "./add-column-header";
import { getTraceColumnDef } from "./columns";
import { buildEvalColumnDef, evalColumnLabel } from "./eval-columns";
import { type Registry, traceRegistry } from "./registry";
import { makeEvalCellDef } from "./registry/cells/trace/eval-result-cell";
import type { CellDef } from "./registry/types";
import { traceSelectColumnDef } from "./select-column";

const SELECT_COL_MIN_PX = 32;
/**
 * Floor for the trace-lens min table width.
 */
const MIN_WIDTH_FLOOR_PX = 800;
const FALLBACK_COL_MIN_SIZE_PX = 100;

const EMPTY_NAMES: Map<string, string> = new Map();

interface TraceLensColumns {
  columns: Array<ColumnDef<TraceListItem, unknown>>;
  registry: Registry<TraceListItem>;
  minWidth: string;
}

/**
 * Resolve the lens's logical column ids into TanStack column defs + the cell registry,
 * in `logicalColumnIds` order.
 */
export function useTraceLensColumns({
  logicalColumnIds,
  evaluatorNames = EMPTY_NAMES,
}: {
  logicalColumnIds: string[];
  evaluatorNames?: Map<string, string>;
}): TraceLensColumns {
  // The Time column's value format (relative ↔ ISO) is a personal display
  // preference, not a per-lens column width — so its sizing isn't baked
  // into the static def. Read it here and widen the def in ISO mode so the
  // full timestamp doesn't clip; the persisted manual-resize override (in
  // columnSizingStore) still wins for the rendered width.
  const timeFormat = useTimeFormatStore((s) => s.format);
  const columns = useMemo(() => {
    const defs: Array<ColumnDef<TraceListItem, unknown>> = [traceSelectColumnDef];
    for (const id of logicalColumnIds) {
      const parsed = parseEvalColumnId(id);
      if (parsed) {
        defs.push(
          buildEvalColumnDef({
            id,
            field: parsed.field,
            evaluatorKey: parsed.evaluatorKey,
            label: evalColumnLabel({
              field: parsed.field,
              evaluatorKey: parsed.evaluatorKey,
              evaluatorNames,
            }),
          }),
        );
        continue;
      }
      const def = getTraceColumnDef(id);
      if (!def) continue;
      if (id === "time") {
        defs.push({ ...def, ...timeColumnSizing(timeFormat) });
        continue;
      }
      defs.push(def);
    }
    // Trailing "+" column — a quick entry point to the column picker,
    // anchored where newly-added columns appear.
    defs.push(addColumnColumnDef);
    return defs;
  }, [logicalColumnIds, evaluatorNames, timeFormat]);

  // Cell renderers for the active eval columns, merged onto the static trace registry.
  const registry = useMemo<Registry<TraceListItem>>(() => {
    const evalCells: Record<string, CellDef<TraceListItem>> = {};
    for (const id of logicalColumnIds) {
      const parsed = parseEvalColumnId(id);
      if (parsed) {
        evalCells[id] = makeEvalCellDef({
          id,
          evaluatorKey: parsed.evaluatorKey,
          field: parsed.field,
        });
      }
    }
    if (Object.keys(evalCells).length === 0) return traceRegistry;
    return {
      ...traceRegistry,
      cells: { ...traceRegistry.cells, ...evalCells },
    };
  }, [logicalColumnIds]);

  const minWidth = useMemo(() => {
    /**
     * Floor the table at "every fixed column at its declared size + every flex column at its minSize + the select gutter." Earlier we used minSize across the board, but that produced
     * a floor *below* what fixed columns actually claim at render time — `tableLayout: fixed` gave each fixed col its declared `size`, the flex col absorbed the deficit, and on narrow
     * viewports the deficit went negative: the trace column collapsed to ~0px and its content visually bled into the next column.
     */
    const widthFor = (def: {
      id?: string;
      size?: number;
      minSize?: number;
      meta?: unknown;
    }): number => {
      const isFlex = (def.meta as { flex?: boolean } | undefined)?.flex;
      if (isFlex) return def.minSize ?? FALLBACK_COL_MIN_SIZE_PX;
      return def.size ?? def.minSize ?? FALLBACK_COL_MIN_SIZE_PX;
    };

    // Sum the body columns; the select column contributes its own fixed
    // gutter rather than its (larger) declared size.
    const total = columns.reduce((sum, c) => {
      if (c.id === traceSelectColumnDef.id) return sum;
      return sum + widthFor(c as { size?: number; minSize?: number; meta?: unknown });
    }, SELECT_COL_MIN_PX);
    return `${Math.max(total, MIN_WIDTH_FLOOR_PX)}px`;
  }, [columns]);

  return { columns, registry, minWidth };
}
