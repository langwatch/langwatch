import { type ColumnDef, createColumnHelper } from "@tanstack/react-table";
import {
  EVAL_FIELD_LABELS,
  type EvalColumnField,
} from "../../lens/evalColumnId";
import type { TraceEvalResult, TraceListItem } from "../../types/trace";

/**
 * Table-layer helpers for per-evaluator eval columns. The id grammar
 * (`eval:<field>:<evaluatorKey>`) lives in the dependency-free
 * `lens/evalColumnId`; this module adds the bits that need the trace data
 * shape and TanStack. See dev/docs/adr/029-trace-table-per-evaluator-columns.md.
 */

/** Resolve the human label for an eval column header / picker entry. */
export function evalColumnLabel({
  field,
  evaluatorKey,
  evaluatorNames,
}: {
  field: EvalColumnField;
  evaluatorKey: string;
  evaluatorNames?: Map<string, string>;
}): string {
  const name = evaluatorNames?.get(evaluatorKey);
  return `${name ?? evaluatorKey} · ${EVAL_FIELD_LABELS[field]}`;
}

/**
 * The latest run of `evaluatorKey` on this trace. The server returns
 * evaluations ordered UpdatedAt DESC, so the first match per evaluator is
 * the most recent run (the first-in-DESC-order rule `EvaluationsCell` also
 * uses). An evaluator-id match takes precedence over a name match across
 * the whole list, so a free-text *name* the user typed still resolves
 * without a stray same-name collision beating the real id.
 */
export function latestEvalForKey({
  row,
  evaluatorKey,
}: {
  row: TraceListItem;
  evaluatorKey: string;
}): TraceEvalResult | undefined {
  return (
    row.evaluations.find((ev) => ev.evaluatorId === evaluatorKey) ??
    row.evaluations.find((ev) => ev.evaluatorName === evaluatorKey)
  );
}

/** The raw field value off a matched run — drives both the cell and the
 *  TanStack accessor (the accessor is wired for a future sort even though
 *  sorting is deferred this round). `null` when the field has no value. */
export function evalFieldValue({
  ev,
  field,
}: {
  ev: TraceEvalResult | undefined;
  field: EvalColumnField;
}): number | boolean | string | null {
  if (!ev) return null;
  if (field === "score") return ev.score;
  if (field === "verdict") return ev.passed;
  return ev.label;
}

const evalCol = createColumnHelper<TraceListItem>();

/**
 * Synthesise the TanStack column def for a per-evaluator eval column. The
 * body cell is rendered through the registry (see `makeEvalCellDef`); this
 * def owns the header label, width, and the accessor used for sizing/sort.
 */
export function buildEvalColumnDef({
  id,
  field,
  evaluatorKey,
  label,
}: {
  id: string;
  field: EvalColumnField;
  evaluatorKey: string;
  label: string;
}): ColumnDef<TraceListItem, ReturnType<typeof evalFieldValue>> {
  return evalCol.accessor(
    (row) =>
      evalFieldValue({ ev: latestEvalForKey({ row, evaluatorKey }), field }),
    {
      id,
      header: label,
      // Score / Verdict are short; Label can run longer. Resizable within
      // a range so a long categorical label can be widened without pushing
      // the trace column off-screen.
      size: 130,
      minSize: 90,
      maxSize: 320,
      enableSorting: false,
    },
  );
}
