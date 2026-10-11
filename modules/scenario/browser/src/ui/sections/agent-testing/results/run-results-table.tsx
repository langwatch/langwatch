/**
 * The results of one run as a table: one row per scenario and target pair, with the
 * verdict, the duration and the cost.
 * @see specs/features/agent-testing/results-tabs.feature
 */

import { ListTable } from "@langwatch/design-system/list-table";
import type { ScenarioRunData } from "@langwatch/scenario-contract";

import { isCancellableStatus } from "../../../../behavior/suites/use-cancel-scenario-run.ts";
import { runHasEvaluators } from "../../../../model/agent-testing/results/evaluation-summaries.ts";
import { anyRunHasCaller } from "./caller-display.ts";
import { type ResultsColumn, ResultsTable, ResultsTableHead } from "./results-table-chrome.tsx";
import { RunResultRow } from "./run-result-row.tsx";

/** The narrowest the scenario name, and the evaluators beside it, are drawn. */
const NAME_FLOOR_PX = 184;

/**
 * The columns of the table, composed from what's shown: the last holds the row menu (wider
 * for a Stop control); Evaluators and Caller (AC24) appear only when a run has one. With
 * evaluators the table keeps a floor under the names and scrolls rather than cutting them.
 */
export function resultColumns({
  hasEvaluators,
  hasCaller,
  hasStoppable,
}: {
  hasEvaluators: boolean;
  hasCaller: boolean;
  hasStoppable: boolean;
}): { columns: ResultsColumn[]; minWidth?: string } {
  const columns: ResultsColumn[] = [
    { key: "result", text: "Result", width: "148px" },
    { key: "scenario", text: "Scenario" },
    ...(hasEvaluators ? [{ key: "evaluators", text: "Evaluators" }] : []),
    ...(hasCaller
      ? [{ key: "caller", text: "Caller", width: "114px" } satisfies ResultsColumn]
      : []),
    { key: "metrics", text: "Time · cost", width: "154px", align: "end" as const },
    { key: "menu", text: "", width: hasStoppable ? "116px" : "52px", action: true },
  ];
  if (!hasEvaluators) return { columns };
  const fixed = columns.reduce((sum, column) => sum + (parseInt(column.width ?? "0", 10) || 0), 0);
  return { columns, minWidth: `${fixed + 2 * NAME_FLOOR_PX}px` };
}

export type RunResultsTableProps = {
  scenarioRuns: ScenarioRunData[];
  resolveTargetName: (scenarioRun: ScenarioRunData) => string | null;
  iterationMap: Map<string, number>;
  onScenarioRunClick: (scenarioRun: ScenarioRunData) => void;
  /** Absent when the person may not stop runs, or when the set is not ours. */
  onCancelRun?: (scenarioRun: ScenarioRunData) => void;
  cancellingJobId?: string | null;
  /** Opens the editor of the scenario the row ran. */
  onEditCase?: (scenarioRun: ScenarioRunData) => void;
  /** Runs the scenario the row ran again, on its own. */
  onRerunCase?: (scenarioRun: ScenarioRunData) => void;
};

export function RunResultsTable({
  scenarioRuns,
  resolveTargetName,
  iterationMap,
  onScenarioRunClick,
  onCancelRun,
  cancellingJobId,
  onEditCase,
  onRerunCase,
}: RunResultsTableProps) {
  const hasStoppable =
    !!onCancelRun && scenarioRuns.some((scenarioRun) => isCancellableStatus(scenarioRun.status));
  const hasEvaluators = scenarioRuns.some(runHasEvaluators);
  const hasCaller = anyRunHasCaller(scenarioRuns);
  const { columns, minWidth } = resultColumns({ hasEvaluators, hasCaller, hasStoppable });

  return (
    <ResultsTable columns={columns} minWidth={minWidth} testId="run-results-table">
      <ResultsTableHead columns={columns} testId="run-results-table-header" />

      <ListTable.Body>
        {scenarioRuns.map((scenarioRun) => (
          <RunResultRow
            key={scenarioRun.scenarioRunId}
            scenarioRun={scenarioRun}
            hasEvaluators={hasEvaluators}
            hasCaller={hasCaller}
            resolveTargetName={resolveTargetName}
            iterationMap={iterationMap}
            onScenarioRunClick={onScenarioRunClick}
            onCancelRun={onCancelRun}
            cancellingJobId={cancellingJobId}
            onEditCase={onEditCase}
            onRerunCase={onRerunCase}
          />
        ))}
      </ListTable.Body>
    </ResultsTable>
  );
}
