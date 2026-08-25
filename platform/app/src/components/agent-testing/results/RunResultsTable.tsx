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

import { Button, HStack, Spinner, Table, Text } from "@chakra-ui/react";
import { MoreVertical, Square } from "lucide-react";
import { buildDisplayTitle } from "~/components/suites/run-history-transforms";
import { isCancellableStatus } from "~/components/suites/useCancelScenarioRun";
import { ListTable } from "~/components/ui/ListTable";
import { Menu } from "~/components/ui/menu";
import { isTerminalStatus } from "~/server/scenarios/scenario-event.enums";
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
  /** Opens the editor of the test case the row ran. */
  onEditCase?: (scenarioRun: ScenarioRunData) => void;
};

/** The row menu: the one thing to do with a result is edit the case it ran. */
function ResultRowActionsMenu({
  displayName,
  onEditCase,
}: {
  displayName: string;
  onEditCase: () => void;
}) {
  const stop = (event: React.MouseEvent) => event.stopPropagation();

  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        <Button
          size="xs"
          variant="ghost"
          aria-label={`Actions for ${displayName}`}
          onClick={stop}
        >
          <MoreVertical size={14} />
        </Button>
      </Menu.Trigger>
      <Menu.Content>
        <Menu.Item
          value="edit-test-case"
          onClick={(event) => {
            stop(event);
            onEditCase();
          }}
        >
          Edit test case
        </Menu.Item>
      </Menu.Content>
    </Menu.Root>
  );
}

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
        {scenarioRuns.map((scenarioRun) => {
          const canCancel =
            !!onCancelRun && isCancellableStatus(scenarioRun.status);
          const isCancelling = cancellingJobId === scenarioRun.scenarioRunId;
          // A run that is still going has no duration and no cost to read: the
          // numbers it carries so far are the ones it started with.
          const hasSettled = isTerminalStatus(scenarioRun.status);
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
                  {hasSettled && (
                    <ResultMetricsInline
                      durationInMs={
                        scenarioRun.durationInMs > 0
                          ? scenarioRun.durationInMs
                          : null
                      }
                      totalCost={scenarioRun.totalCost ?? null}
                    />
                  )}
                </HStack>
              </Table.Cell>
              <Table.Cell textAlign="right">
                <HStack gap={1} justify="flex-end">
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
                  {onEditCase && (
                    <ResultRowActionsMenu
                      displayName={displayName}
                      onEditCase={() => onEditCase(scenarioRun)}
                    />
                  )}
                </HStack>
              </Table.Cell>
            </Table.Row>
          );
        })}
      </Table.Body>
    </ListTable>
  );
}
