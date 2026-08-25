/**
 * One row of the run results table: a test case and target pair, its verdict,
 * its duration and its cost.
 *
 * @see specs/features/agent-testing/results-tabs.feature
 */

import { Button, HStack, Spinner, Table, Text } from "@chakra-ui/react";
import { MoreVertical, Square } from "lucide-react";
import { buildDisplayTitle } from "~/components/suites/run-history-transforms";
import { isCancellableStatus } from "~/components/suites/useCancelScenarioRun";
import { Menu } from "~/components/ui/menu";
import { isTerminalStatus } from "~/server/scenarios/scenario-event.enums";
import type { ScenarioRunData } from "~/server/scenarios/scenario-event.types";
import { LastResultLabel } from "../shared/LastResultLabel";
import { ResultMetricsInline } from "../shared/ResultMetricsInline";
import type { RunResultsTableProps } from "./RunResultsTable";

export type RunResultRowProps = Pick<
  RunResultsTableProps,
  | "resolveTargetName"
  | "iterationMap"
  | "onScenarioRunClick"
  | "onCancelRun"
  | "cancellingJobId"
  | "onEditCase"
> & { scenarioRun: ScenarioRunData };

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

/** The Stop control, on a row that is still going. */
function StopRunButton({
  displayName,
  isCancelling,
  onCancel,
}: {
  displayName: string;
  isCancelling: boolean;
  onCancel: () => void;
}) {
  return (
    <Button
      size="xs"
      variant="outline"
      aria-label={`Stop ${displayName}`}
      disabled={isCancelling}
      onClick={(event) => {
        event.stopPropagation();
        onCancel();
      }}
      data-testid="cancel-run-button"
    >
      {isCancelling ? <Spinner size="xs" /> : <Square size={10} />}
      Stop
    </Button>
  );
}

/** The time and the cost, which only a settled run carries. */
function RowMetrics({ scenarioRun }: { scenarioRun: ScenarioRunData }) {
  // A run that is still going has no duration and no cost to read: the
  // numbers it carries so far are the ones it started with.
  if (!isTerminalStatus(scenarioRun.status)) return null;

  return (
    <ResultMetricsInline
      durationInMs={
        scenarioRun.durationInMs > 0 ? scenarioRun.durationInMs : null
      }
      totalCost={scenarioRun.totalCost ?? null}
    />
  );
}

/** The controls of one row: stopping it, and reaching the case it ran. */
function RowActions({
  scenarioRun,
  displayName,
  onCancelRun,
  cancellingJobId,
  onEditCase,
}: Pick<
  RunResultRowProps,
  "scenarioRun" | "onCancelRun" | "cancellingJobId" | "onEditCase"
> & { displayName: string }) {
  const canCancel = !!onCancelRun && isCancellableStatus(scenarioRun.status);

  return (
    <HStack gap={1} justify="flex-end">
      {canCancel ? (
        <StopRunButton
          displayName={displayName}
          isCancelling={cancellingJobId === scenarioRun.scenarioRunId}
          onCancel={() => onCancelRun?.(scenarioRun)}
        />
      ) : null}
      {onEditCase && (
        <ResultRowActionsMenu
          displayName={displayName}
          onEditCase={() => onEditCase(scenarioRun)}
        />
      )}
    </HStack>
  );
}

export function RunResultRow({
  scenarioRun,
  resolveTargetName,
  iterationMap,
  onScenarioRunClick,
  onCancelRun,
  cancellingJobId,
  onEditCase,
}: RunResultRowProps) {
  const displayName = buildDisplayTitle({
    scenarioName: scenarioRun.name ?? scenarioRun.scenarioId,
    targetName: resolveTargetName(scenarioRun),
    iteration: iterationMap.get(scenarioRun.scenarioRunId),
  });

  return (
    <Table.Row
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
          <RowMetrics scenarioRun={scenarioRun} />
        </HStack>
      </Table.Cell>
      <Table.Cell textAlign="right">
        <RowActions
          scenarioRun={scenarioRun}
          displayName={displayName}
          onCancelRun={onCancelRun}
          cancellingJobId={cancellingJobId}
          onEditCase={onEditCase}
        />
      </Table.Cell>
    </Table.Row>
  );
}
