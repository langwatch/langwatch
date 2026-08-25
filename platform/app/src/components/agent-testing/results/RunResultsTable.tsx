/**
 * The results of one run as a table: one row per test case and target pair,
 * with the verdict, the duration and the cost.
 *
 * A row that is still going can be stopped on its own. A row that finished
 * carries no Stop control. The time and the cost are only read once the run
 * has settled: a run that just started has neither.
 *
 * @see specs/features/agent-testing/results-tabs.feature
 */

import { Table } from "@chakra-ui/react";
import { ListTable } from "~/components/ui/ListTable";
import type { ScenarioRunData } from "~/server/scenarios/scenario-event.types";
import { RunResultRow } from "./RunResultRow";

export type RunResultsTableProps = {
  scenarioRuns: ScenarioRunData[];
  resolveTargetName: (scenarioRun: ScenarioRunData) => string | null;
  iterationMap: Map<string, number>;
  onScenarioRunClick: (scenarioRun: ScenarioRunData) => void;
  /** Absent when the person may not stop runs, or when the set is not ours. */
  onCancelRun?: (scenarioRun: ScenarioRunData) => void;
  cancellingJobId?: string | null;
  /** Opens the editor of the test case the row ran. */
  onEditCase?: (scenarioRun: ScenarioRunData) => void;
};

export function RunResultsTable({
  scenarioRuns,
  resolveTargetName,
  iterationMap,
  onScenarioRunClick,
  onCancelRun,
  cancellingJobId,
  onEditCase,
}: RunResultsTableProps) {
  return (
    <ListTable size="sm" data-testid="run-results-table">
      <Table.Header>
        <Table.Row>
          <Table.ColumnHeader width="170px">Result</Table.ColumnHeader>
          <Table.ColumnHeader>Test case</Table.ColumnHeader>
          <Table.ColumnHeader width="150px" textAlign="right">
            Time · cost
          </Table.ColumnHeader>
          <Table.ColumnHeader width="130px" />
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {scenarioRuns.map((scenarioRun) => (
          <RunResultRow
            key={scenarioRun.scenarioRunId}
            scenarioRun={scenarioRun}
            resolveTargetName={resolveTargetName}
            iterationMap={iterationMap}
            onScenarioRunClick={onScenarioRunClick}
            onCancelRun={onCancelRun}
            cancellingJobId={cancellingJobId}
            onEditCase={onEditCase}
          />
        ))}
      </Table.Body>
    </ListTable>
  );
}
