/**
 * One row of the run results table: a test case and target pair, its verdict,
 * its evaluators, its duration and its cost.
 *
 * @see specs/features/agent-testing/results-tabs.feature
 */

import { Box, Button, HStack, Spinner, Text } from "@chakra-ui/react";
import {
  MessageSquare,
  MoreVertical,
  Pencil,
  Play,
  Square,
} from "lucide-react";
import { buildDisplayTitle } from "~/components/suites/run-history-transforms";
import { isCancellableStatus } from "~/components/suites/useCancelScenarioRun";
import { Menu } from "~/components/ui/menu";
import { isTerminalStatus } from "~/server/scenarios/scenario-event.enums";
import type { ScenarioRunData } from "~/server/scenarios/scenario-event.types";
import { ROW_HOVER_BG } from "../shared/design";
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
  | "onRerunCase"
> & {
  scenarioRun: ScenarioRunData;
  templateColumns: string;
  /** True while any row of the run can still be stopped. */
  hasStoppable: boolean;
};

/** The row menu: reach the conversation, run the case again, or edit it. */
function ResultRowActionsMenu({
  displayName,
  onOpenConversation,
  onRerunCase,
  onEditCase,
}: {
  displayName: string;
  onOpenConversation: () => void;
  onRerunCase?: () => void;
  onEditCase?: () => void;
}) {
  const stop = (event: React.MouseEvent) => event.stopPropagation();

  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        <Button
          size="xs"
          variant="ghost"
          minWidth="24px"
          height="24px"
          paddingX={0}
          aria-label={`Actions for ${displayName}`}
          onClick={stop}
        >
          <MoreVertical size={14} />
        </Button>
      </Menu.Trigger>
      <Menu.Content>
        <Menu.Item
          value="open-conversation"
          onClick={(event) => {
            stop(event);
            onOpenConversation();
          }}
        >
          <MessageSquare size={13} /> Open the conversation
        </Menu.Item>
        {onRerunCase && (
          <Menu.Item
            value="rerun-test-case"
            onClick={(event) => {
              stop(event);
              onRerunCase();
            }}
          >
            <Play size={13} /> Rerun this test case
          </Menu.Item>
        )}
        {onEditCase && (
          <Menu.Item
            value="edit-test-case"
            onClick={(event) => {
              stop(event);
              onEditCase();
            }}
          >
            <Pencil size={13} /> Edit test case
          </Menu.Item>
        )}
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
      height="24px"
      fontSize="11px"
      paddingX={2}
      gap={1}
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

export function RunResultRow({
  scenarioRun,
  templateColumns,
  hasStoppable,
  resolveTargetName,
  iterationMap,
  onScenarioRunClick,
  onCancelRun,
  cancellingJobId,
  onEditCase,
  onRerunCase,
}: RunResultRowProps) {
  const displayName = buildDisplayTitle({
    scenarioName: scenarioRun.name ?? scenarioRun.scenarioId,
    targetName: resolveTargetName(scenarioRun),
    iteration: iterationMap.get(scenarioRun.scenarioRunId),
  });
  const canCancel = !!onCancelRun && isCancellableStatus(scenarioRun.status);

  return (
    <Box
      display="grid"
      gridTemplateColumns={templateColumns}
      columnGap={3}
      alignItems="start"
      paddingX={4}
      paddingY="10px"
      cursor="pointer"
      _hover={{ background: ROW_HOVER_BG }}
      onClick={() => onScenarioRunClick(scenarioRun)}
      data-testid={`run-result-row-${scenarioRun.scenarioRunId}`}
    >
      <Box paddingTop="1px">
        <LastResultLabel
          status={scenarioRun.status}
          results={scenarioRun.results ?? undefined}
        />
      </Box>

      <HStack gap={1.5} minWidth={0} flexWrap="wrap" paddingTop="1px">
        <Text fontSize="12.5px" fontWeight="medium" color="fg" truncate>
          {displayName}
        </Text>
      </HStack>

      {/* The evaluator scores of a result will read here. */}
      <Box />

      <Box paddingTop="1px" textAlign="right">
        <RowMetrics scenarioRun={scenarioRun} />
      </Box>

      <HStack
        gap={1}
        justify="flex-end"
        minWidth={hasStoppable ? "88px" : undefined}
        onClick={(event) => event.stopPropagation()}
      >
        {canCancel ? (
          <StopRunButton
            displayName={displayName}
            isCancelling={cancellingJobId === scenarioRun.scenarioRunId}
            onCancel={() => onCancelRun?.(scenarioRun)}
          />
        ) : null}
        <ResultRowActionsMenu
          displayName={displayName}
          onOpenConversation={() => onScenarioRunClick(scenarioRun)}
          onRerunCase={onRerunCase ? () => onRerunCase(scenarioRun) : undefined}
          onEditCase={onEditCase ? () => onEditCase(scenarioRun) : undefined}
        />
      </HStack>
    </Box>
  );
}
