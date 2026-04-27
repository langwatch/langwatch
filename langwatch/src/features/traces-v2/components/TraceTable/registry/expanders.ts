import type { ColumnDef } from "@tanstack/react-table";
import type { TraceListItem } from "../../../types/trace";
import {
  getTraceColumnDef,
  makeEvalColumnDef,
  makeEventColumnDef,
} from "../columns";
import {
  ErrorTextCell,
  InputCell,
  OutputCell,
  SpanNameCell,
  SpanTypeCell,
  TraceIdCell,
} from "./cells/trace";
import {
  makeEvalCellDef,
  uniqueEvaluators,
} from "./cells/trace/dynamicEvalCell";
import {
  makeEventCellDef,
  uniqueEventNames,
} from "./cells/trace/dynamicEventCell";
import type { CellDef } from "./types";

export interface ExpandedColumn<TRow> {
  id: string;
  cellDef: CellDef<TRow>;
  columnDef: ColumnDef<TRow, any>;
}

export type ColumnExpander<TRow> = (rows: TRow[]) => ExpandedColumn<TRow>[];

const TRACE_EXPANSION: ExpandedColumn<TraceListItem>[] = [
  { id: SpanNameCell.id, cellDef: SpanNameCell, columnDef: getTraceColumnDef("span-name")! },
  { id: SpanTypeCell.id, cellDef: SpanTypeCell, columnDef: getTraceColumnDef("span-type")! },
  { id: TraceIdCell.id, cellDef: TraceIdCell, columnDef: getTraceColumnDef("trace-id")! },
  { id: InputCell.id, cellDef: InputCell, columnDef: getTraceColumnDef("input")! },
  { id: OutputCell.id, cellDef: OutputCell, columnDef: getTraceColumnDef("output")! },
];

const ERROR_TEXT_COLUMN: ExpandedColumn<TraceListItem> = {
  id: ErrorTextCell.id,
  cellDef: ErrorTextCell,
  columnDef: getTraceColumnDef("error-text")!,
};

export const traceComfortableExpanders: Record<
  string,
  ColumnExpander<TraceListItem>
> = {
  trace: (rows) => {
    const cols = [...TRACE_EXPANSION];
    if (rows.some((r) => Boolean(r.error))) {
      cols.push(ERROR_TEXT_COLUMN);
    }
    return cols;
  },
  evaluations: (rows) =>
    uniqueEvaluators(rows).map((key) => ({
      id: `eval:${key.evaluatorId}`,
      cellDef: makeEvalCellDef(key),
      columnDef: makeEvalColumnDef(key.evaluatorId, key.evaluatorName),
    })),
  events: (rows) =>
    uniqueEventNames(rows).map((name) => ({
      id: `event:${name}`,
      cellDef: makeEventCellDef(name),
      columnDef: makeEventColumnDef(name),
    })),
};

/**
 * Expand a lens's logical column ids into the concrete columns that should
 * render in comfortable density. Logical ids without an expander pass through
 * with their default column def + cell def.
 */
export function expandTraceColumns(
  logicalIds: string[],
  rows: TraceListItem[],
  fallbackCells: Record<string, CellDef<TraceListItem>>,
): ExpandedColumn<TraceListItem>[] {
  return logicalIds.flatMap((id) => {
    const expander = traceComfortableExpanders[id];
    if (expander) return expander(rows);
    const columnDef = getTraceColumnDef(id);
    const cellDef = fallbackCells[id];
    if (!columnDef || !cellDef) return [];
    return [{ id, cellDef, columnDef }];
  });
}
