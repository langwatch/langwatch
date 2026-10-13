/**
 * One row of the run results table: a scenario and target pair, its verdict, its
 * evaluators, its duration and its cost.
 * @see specs/features/agent-testing/results-tabs.feature
 */

import { MoreVerticalIcon } from "@langwatch/design-system/icons";
import { ListTable } from "@langwatch/design-system/list-table";
import { Menu } from "@langwatch/design-system/menu";
import { Box, Button, chakra, HStack, Spinner, Text } from "@langwatch/design-system/primitives";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { isTerminalStatus } from "@langwatch/scenario-contract";
import type { ScenarioRunData } from "@langwatch/scenario-contract";
import { MessageSquare, Pencil, Play, Square } from "lucide-react";

import { isCancellableStatus } from "../../../../behavior/suites/use-cancel-scenario-run.ts";
import {
  evaluationsOf,
  isAwaitingEvaluations,
} from "../../../../model/agent-testing/results/evaluation-summaries.ts";
import { buildDisplayTitle } from "../../../../model/suite/run-history-transforms.ts";
import {
  EvaluatorPill,
  readingOfEvaluation,
} from "../../../elements/agent-testing/shared/evaluator-pill.tsx";
import { LastResultLabel } from "../../../elements/agent-testing/shared/last-result-label.tsx";
import { ResultMetricsInline } from "../../../elements/agent-testing/shared/result-metrics-inline.tsx";
import { RUN_AGAIN_LABEL } from "../run-plan-results/run-plan-detail-header.tsx";
import {
  canRunAgain,
  RUN_AGAIN_FROM_CODE_REASON,
} from "../run-plan-results/use-run-plan-run-dialog.ts";
import { callerLabel, runCallerKind } from "./caller-display.ts";
import type { RunResultsTableProps } from "./run-results-table.tsx";

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
  /** True when the table draws an Evaluators column. */
  hasEvaluators: boolean;
  /** True when the table draws a Caller column (AC24). */
  hasCaller: boolean;
};

/** The row menu: reach the conversation, run the case again, or edit it. */
function ResultRowActionsMenu({
  displayName,
  onOpenConversation,
  onRerunCase,
  isRerunDisabled,
  onEditCase,
}: {
  displayName: string;
  onOpenConversation: () => void;
  onRerunCase?: () => void;
  /** True for a run from code, which the platform cannot run again. */
  isRerunDisabled: boolean;
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
          <MoreVerticalIcon size={14} />
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
          <Tooltip content={RUN_AGAIN_FROM_CODE_REASON} disabled={!isRerunDisabled}>
            <Menu.Item
              value="rerun-test-case"
              disabled={isRerunDisabled}
              onClick={(event) => {
                stop(event);
                onRerunCase();
              }}
            >
              <Play size={13} /> {RUN_AGAIN_LABEL}
            </Menu.Item>
          </Tooltip>
        )}
        {onEditCase && (
          <Menu.Item
            value="edit-test-case"
            onClick={(event) => {
              stop(event);
              onEditCase();
            }}
          >
            <Pencil size={13} /> Edit scenario
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
      textStyle="micro"
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

/**
 * One pill per evaluator that ran on the scenario. A row still waiting says
 * it is grading, in muted text, distinct from no check having run. A
 * skipped evaluator keeps its pill, muted, distinct from never having run.
 */
function RowEvaluators({ scenarioRun }: { scenarioRun: ScenarioRunData }) {
  const evaluations = evaluationsOf(scenarioRun);
  if (evaluations.length === 0) {
    if (!isAwaitingEvaluations(scenarioRun)) return null;
    return (
      <HStack gap={1.5} data-testid="run-result-evaluators-grading">
        <Spinner size="xs" color="fg.muted" />
        <Text textStyle="caption" fontWeight="medium" color="fg.muted">
          Grading
        </Text>
      </HStack>
    );
  }

  return (
    <HStack gap={1} flexWrap="wrap" data-testid="run-result-evaluators">
      {evaluations.map((evaluation, at) => (
        <EvaluatorPill
          key={`${evaluation.evaluatorId}-${at}`}
          evaluatorId={evaluation.evaluatorId}
          name={evaluation.name}
          reading={readingOfEvaluation(evaluation)}
        />
      ))}
    </HStack>
  );
}

/** The time and the cost, which only a settled run carries. */
function RowMetrics({ scenarioRun }: { scenarioRun: ScenarioRunData }) {
  // A run that is still going has no duration and no cost to read: the
  // numbers it carries so far are the ones it started with.
  if (!isTerminalStatus(scenarioRun.status)) return null;

  return (
    <ResultMetricsInline
      durationInMs={scenarioRun.durationInMs > 0 ? scenarioRun.durationInMs : null}
      totalCost={scenarioRun.totalCost ?? null}
    />
  );
}

function RowCaller({ scenarioRun }: { scenarioRun: ScenarioRunData }) {
  const kind = runCallerKind(scenarioRun);
  if (!kind) return null;
  return (
    <Text textStyle="caption" color="fg.muted">
      {callerLabel(kind)}
    </Text>
  );
}

export function RunResultRow({
  scenarioRun,
  hasEvaluators,
  hasCaller,
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
    <ListTable.Row
      onActivate={() => onScenarioRunClick(scenarioRun)}
      data-testid={`run-result-row-${scenarioRun.scenarioRunId}`}
    >
      <ListTable.Cell valign="top">
        <Box paddingTop="1px">
          <LastResultLabel status={scenarioRun.status} results={scenarioRun.results ?? undefined} />
        </Box>
      </ListTable.Cell>

      <ListTable.Cell valign="top">
        <HStack gap={1.5} minWidth={0} flexWrap="wrap" paddingTop="1px">
          <chakra.button
            type="button"
            minWidth={0}
            maxWidth="full"
            textAlign="left"
            cursor="pointer"
            onClick={(event) => {
              event.stopPropagation();
              onScenarioRunClick(scenarioRun);
            }}
          >
            <Text textStyle="bodySm" fontWeight="medium" color="fg" truncate>
              {displayName}
            </Text>
          </chakra.button>
        </HStack>
      </ListTable.Cell>

      {hasEvaluators ? (
        <ListTable.Cell valign="top">
          <RowEvaluators scenarioRun={scenarioRun} />
        </ListTable.Cell>
      ) : null}

      {hasCaller ? (
        <ListTable.Cell valign="top">
          <Box paddingTop="1px" minWidth={0}>
            <RowCaller scenarioRun={scenarioRun} />
          </Box>
        </ListTable.Cell>
      ) : null}

      <ListTable.Cell align="end" valign="top">
        <Box paddingTop="1px">
          <RowMetrics scenarioRun={scenarioRun} />
        </Box>
      </ListTable.Cell>

      <ListTable.ActionCell>
        <HStack gap={1} justify="flex-end">
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
            isRerunDisabled={!canRunAgain({ scenarioRun })}
            onEditCase={onEditCase ? () => onEditCase(scenarioRun) : undefined}
          />
        </HStack>
      </ListTable.ActionCell>
    </ListTable.Row>
  );
}
