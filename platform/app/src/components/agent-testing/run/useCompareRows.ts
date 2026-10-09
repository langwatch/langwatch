/**
 * Moving the run dialog into a comparison and back, and editing its rows.
 *
 * Entering takes the agent and the parameter line the dialog holds into row
 * one. Leaving, by the x of the section or by removing rows down to one, puts
 * the remaining row back: its agent becomes the agent to be tested and its
 * line goes back to the Parameters section. The secret rows never move: they
 * are run-level and shared across the targets either way.
 *
 * @see specs/features/agent-testing/comparison-mode.feature
 */

import { useCallback } from "react";
import type { DeclaredParameter } from "~/components/suites/useRunSuite";
import {
  addCompareRow,
  type CompareRow,
  hasDuplicateCompareRows,
  initialCompareRows,
  MAX_COMPARE_ROWS,
  type ParameterDefaults,
} from "./compare-rows";
import { lineFromRows, rowsFromLine } from "./parameter-rows";
import type { RunDialogAgent } from "./RunTargetPicker";
import type { RunDialogFields } from "./useRunDialogForm";
import type { RunPlanFields } from "./useRunPlanFields";

/** The two moves between the one-agent dialog and the comparison. */
function useCompareTransitions({
  fields,
  planFields,
  agents,
}: {
  fields: RunDialogFields;
  planFields: RunPlanFields;
  agents: readonly RunDialogAgent[];
}) {
  const { setCompareRows } = planFields;
  const { target, setTarget, showParams, parameterLine, parameterRows } =
    fields;
  const { setShowParams, setParameterLine, setParameterRows } = fields;
  const { setRowsRequested, secretValues } = fields;

  /** Opens the rows on the agent and the line the dialog holds. */
  const enterCompare = useCallback(() => {
    const line = !showParams
      ? ""
      : parameterRows
        ? lineFromRows(parameterRows)
        : parameterLine;
    const secretRows = (parameterRows ?? []).filter((row) => row.secret);
    setCompareRows(initialCompareRows({ target, parameterLine: line, agents }));
    setParameterLine("");
    setParameterRows(secretRows.length > 0 ? secretRows : null);
    setRowsRequested(secretRows.length > 0);
  }, [
    showParams,
    parameterRows,
    parameterLine,
    target,
    agents,
    setCompareRows,
    setParameterLine,
    setParameterRows,
    setRowsRequested,
  ]);

  /** Puts one row back as the agent to be tested, with its line. */
  const leaveCompare = useCallback(
    (row: CompareRow) => {
      const secretRows = (parameterRows ?? []).filter((r) => r.secret);
      const line = row.parameterLine.trim();
      const hasTypedSecret = Object.values(secretValues).some((v) => v !== "");
      setTarget(row.target);
      setParameterLine(line);
      setParameterRows(
        secretRows.length > 0 ? [...rowsFromLine(line), ...secretRows] : null,
      );
      setRowsRequested(secretRows.length > 0);
      setShowParams(line !== "" || secretRows.length > 0 || hasTypedSecret);
      setCompareRows([]);
    },
    [
      parameterRows,
      secretValues,
      setTarget,
      setParameterLine,
      setParameterRows,
      setRowsRequested,
      setShowParams,
      setCompareRows,
    ],
  );

  return { enterCompare, leaveCompare };
}

export function useCompareRows({
  fields,
  planFields,
  agents,
  defaults,
  definitions,
}: {
  fields: RunDialogFields;
  planFields: RunPlanFields;
  agents: readonly RunDialogAgent[];
  /** The declared defaults, which a typed value equal to does not override. */
  defaults: ParameterDefaults;
  /** The declarations in scope, for the type each value is read as. */
  definitions: readonly DeclaredParameter[];
}) {
  const { compareRows, setCompareRows } = planFields;
  const { setTarget, setParameterError } = fields;
  const { enterCompare, leaveCompare } = useCompareTransitions({
    fields,
    planFields,
    agents,
  });

  const removeComparison = useCallback(() => {
    const first = compareRows[0];
    if (first) leaveCompare(first);
  }, [compareRows, leaveCompare]);

  const updateCompareRow = useCallback(
    (index: number, patch: Partial<CompareRow>) => {
      setCompareRows(
        compareRows.map((row, at) =>
          at === index ? { ...row, ...patch } : row,
        ),
      );
      setParameterError(null);
      // The first row is the agent the run is remembered under.
      if (index === 0 && patch.target) setTarget(patch.target);
    },
    [compareRows, setCompareRows, setTarget, setParameterError],
  );

  const addRow = useCallback(() => {
    setCompareRows(addCompareRow(compareRows));
  }, [compareRows, setCompareRows]);

  const removeCompareRow = useCallback(
    (index: number) => {
      const rest = compareRows.filter((_, at) => at !== index);
      const only = rest[0];
      if (rest.length <= 1 && only) {
        leaveCompare(only);
        return;
      }
      setCompareRows(rest);
    },
    [compareRows, setCompareRows, leaveCompare],
  );

  return {
    enterCompare,
    removeComparison,
    updateCompareRow,
    addCompareRow: addRow,
    removeCompareRow,
    canAddCompareRow: compareRows.length < MAX_COMPARE_ROWS,
    hasDuplicateCompareRows: hasDuplicateCompareRows({
      rows: compareRows,
      defaults,
      definitions,
    }),
  };
}
