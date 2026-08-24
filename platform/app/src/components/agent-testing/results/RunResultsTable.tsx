/**
 * The results of one run as a table: one row per test case and target pair,
 * with the verdict, the duration and the cost.
 *
 * A row that is still going can be stopped on its own. A row that finished
 * carries no Stop control.
 *
 * @see specs/features/agent-testing/results-tabs.feature
 */

import { Button, HStack, Spinner, Table, Text } from "@chakra-ui/react";
import { Square } from "lucide-react";
import { buildDisplayTitle } from "~/components/suites/run-history-transforms";
import { isCancellableStatus } from "~/components/suites/useCancelScenarioRun";
import { ListTable } from "~/components/ui/ListTable";
import type { ScenarioRunData } from "~/server/scenarios/scenario-event.types";
import { LastResultLabel } from "../shared/LastResultLabel";
import { ResultMetricsInline } from "../shared/ResultMetricsInline";

export type RunResultsTableProps = {
  scenarioRuns: ScenarioRunData[];
  resolveTargetName: (scenarioRun: ScenarioRunData) => string | null;
  iterationMap: Map<string, number>;
  onScenarioRunClick: (scenarioRun: ScenarioRunData) => void;
  /** Absent when the person may not stop runs, or when the set is not ours. */
  onCancelRun?: (scenarioRun: ScenarioRunData) => void;
  cancellingJobId?: string | null;
};

export function RunResultsTable({
  scenarioRuns,
  resolveTargetName,
  iterationMap,
  onScenarioRunClick,
  onCancelRun,
  cancellingJobId,
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
          <Table.ColumnHeader width="90px" />
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {scenarioRuns.map((scenarioRun) => {
          const canCancel =
            !!onCancelRun && isCancellableStatus(scenarioRun.status);
          const isCancelling = cancellingJobId === scenarioRun.scenarioRunId;
          const displayName = buildDisplayTitle({
            scenarioName: scenarioRun.name ?? scenarioRun.scenarioId,
            targetName: resolveTargetName(scenarioRun),
            iteration: iterationMap.get(scenarioRun.scenarioRunId),
          });

          return (
            <Table.Row
              key={scenarioRun.scenarioRunId}
              cursor="pointer"
              _hover={{ background: "bg.muted" }}
              onClick={() => onScenarioRunClick(scenarioRun)}
              data-testid={`run-result-row-${scenarioRun.scenarioRunId}`}
            >
              <Table.Cell>
                <LastResultLabel
                  status={scenarioRun.status}
                  results={scenarioRun.results ?? undefined}
                />
              </Table.Cell>
              <Table.Cell>
                <Text fontSize="sm" truncate>
                  {displayName}
                </Text>
              </Table.Cell>
              <Table.Cell textAlign="right">
                <HStack justify="flex-end">
                  <ResultMetricsInline
                    durationInMs={
                      scenarioRun.durationInMs > 0
                        ? scenarioRun.durationInMs
                        : null
                    }
                    totalCost={scenarioRun.totalCost ?? null}
                  />
                </HStack>
              </Table.Cell>
              <Table.Cell textAlign="right">
                {canCancel ? (
                  <Button
                    size="xs"
                    variant="outline"
                    aria-label={`Stop ${displayName}`}
                    disabled={isCancelling}
                    onClick={(event) => {
                      event.stopPropagation();
                      onCancelRun?.(scenarioRun);
                    }}
                    data-testid="cancel-run-button"
                  >
                    {isCancelling ? (
                      <Spinner size="xs" />
                    ) : (
                      <Square size={10} />
                    )}
                    Stop
                  </Button>
                ) : null}
              </Table.Cell>
            </Table.Row>
          );
        })}
      </Table.Body>
    </ListTable>
  );
}
