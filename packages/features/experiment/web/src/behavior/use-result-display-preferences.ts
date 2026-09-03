/**
 * Result-display preferences for the batch evaluation results table.
 *
 * Row height persists across sessions — density is a reading preference,
 * not tied to any one run. Field visibility deliberately does not: a field
 * hidden on a previous visit should never silently explain "no results" on
 * a different run, so it always starts from the defaults.
 */
import { useCallback, useState } from "react";
import { useLocalStorage } from "usehooks-ts";
import { DEFAULT_ROW_HEIGHT, type RowHeight } from "../model/batch-evaluation-results.row-height";

export type ResultField = "outputs" | "scores" | "costAndLatency";

export const DEFAULT_RESULT_FIELDS: Record<ResultField, boolean> = {
  outputs: true,
  scores: true,
  costAndLatency: true,
};

const ROW_HEIGHT_STORAGE_KEY = "batch-results-row-height";

export function useResultDisplayPreferences() {
  const [fields, setFields] = useState<Record<ResultField, boolean>>(DEFAULT_RESULT_FIELDS);
  const [rowHeight, setRowHeight] = useLocalStorage<RowHeight>(
    ROW_HEIGHT_STORAGE_KEY,
    DEFAULT_ROW_HEIGHT,
  );

  const toggleField = useCallback((field: ResultField) => {
    setFields((prev) => ({ ...prev, [field]: !prev[field] }));
  }, []);

  return { fields, toggleField, rowHeight, setRowHeight };
}
