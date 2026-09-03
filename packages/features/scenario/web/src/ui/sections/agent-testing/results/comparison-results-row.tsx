/**
 * One scenario of a comparison across every target, and the run lines a cell
 * of that row holds.
 *
 * A cell stacks one line per run of its scenario and target, so a run that
 * repeated reads three verdicts rather than one. Each line opens the same run
 * drawer a row of the single-target table opens, which is where rerun and the
 * editor live, so the rows carry no menu of their own. A scenario the run
 * never went against with a target says so in that cell.
 *
 * @see specs/features/agent-testing/comparison-mode.feature
 */

import { Box, Button, chakra, HStack, Spinner, Text } from "@chakra-ui/react";
import { Square } from "lucide-react";
import { isCancellableStatus } from "../../../../behavior/suites/use-cancel-scenario-run";
import { isTerminalStatus } from "@langwatch/scenario-contract";
import type { ScenarioRunData } from "@langwatch/scenario-contract";
import { FG_MUTED, ROW_HOVER_BG } from "../../../../model/agent-testing/shared/design";
import { LastResultLabel } from "../../../elements/agent-testing/shared/last-result-label";
import { ResultMetricsInline } from "../../../elements/agent-testing/shared/result-metrics-inline";
import { type BatchTarget, runsOfTarget } from "./use-batch-targets";

/** What a cell reads when the run never went against that target. */
export const NOT_IN_RUN_LABEL = "not in run";

/** One scenario of the run, as the matrix names its row. */
export type ScenarioLine = { scenarioId: string; name: string };

/** What a run line needs to open a run, and to stop one that is still going. */
export type RunLineHandlers = {
  onScenarioRunClick: (scenarioRun: ScenarioRunData) => void;
  /** Absent when the person may not stop runs, or when the set is not ours. */
  onCancelRun?: (scenarioRun: ScenarioRunData) => void;
  cancellingJobId?: string | null;
};

/** The runs of one scenario against one target, in a stable order. */
function cellRuns({
  scenarioRuns,
  scenarioId,
  target,
}: {
  scenarioRuns: ScenarioRunData[];
  scenarioId: string;
  target: BatchTarget;
}): ScenarioRunData[] {
  return runsOfTarget({ scenarioRuns, target })
    .filter((run) => run.scenarioId === scenarioId)
    .sort((left, right) => left.scenarioRunId.localeCompare(right.scenarioRunId));
}

/** The Stop control, on a run that is still going. */
function StopRunButton({
  isCancelling,
  onCancel,
}: {
  isCancelling: boolean;
  onCancel: () => void;
}) {
  return (
    <Button
      size="xs"
      variant="outline"
      height="22px"
      fontSize="11px"
      paddingX={2}
      gap={1}
      aria-label="Stop"
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

/** One run inside a cell: its verdict, and its time and cost once settled. */
function RunLine({
  scenarioRun,
  onScenarioRunClick,
  onCancelRun,
  cancellingJobId,
}: RunLineHandlers & { scenarioRun: ScenarioRunData }) {
  const canCancel = !!onCancelRun && isCancellableStatus(scenarioRun.status);
  const isSettled = isTerminalStatus(scenarioRun.status);

  return (
    <HStack gap={2} align="flex-start" width="full">
      <chakra.button
        type="button"
        flex={1}
        minWidth={0}
        textAlign="left"
        cursor="pointer"
        borderRadius="md"
        paddingX={1.5}
        paddingY={1}
        marginX={-1.5}
        _hover={{ background: ROW_HOVER_BG }}
        onClick={() => onScenarioRunClick(scenarioRun)}
        data-testid={`comparison-run-${scenarioRun.scenarioRunId}`}
      >
        <LastResultLabel status={scenarioRun.status} results={scenarioRun.results ?? undefined} />
        {isSettled ? (
          <ResultMetricsInline
            durationInMs={scenarioRun.durationInMs > 0 ? scenarioRun.durationInMs : null}
            totalCost={scenarioRun.totalCost ?? null}
          />
        ) : null}
      </chakra.button>
      {canCancel ? (
        <StopRunButton
          isCancelling={cancellingJobId === scenarioRun.scenarioRunId}
          onCancel={() => onCancelRun?.(scenarioRun)}
        />
      ) : null}
    </HStack>
  );
}

/** One cell: every run of this scenario against this target. */
function MatrixCell({
  scenario,
  target,
  scenarioRuns,
  ...handlers
}: RunLineHandlers & {
  scenario: ScenarioLine;
  target: BatchTarget;
  scenarioRuns: ScenarioRunData[];
}) {
  const runs = cellRuns({
    scenarioRuns,
    scenarioId: scenario.scenarioId,
    target,
  });

  return (
    <Box
      display="flex"
      flexDirection="column"
      alignItems="stretch"
      gap={1}
      minWidth={0}
      data-testid={`comparison-cell-${scenario.scenarioId}-${target.key}`}
    >
      {runs.length === 0 ? (
        <Text fontSize="11.5px" color={FG_MUTED} paddingTop="5px">
          {NOT_IN_RUN_LABEL}
        </Text>
      ) : (
        runs.map((scenarioRun) => (
          <RunLine key={scenarioRun.scenarioRunId} scenarioRun={scenarioRun} {...handlers} />
        ))
      )}
    </Box>
  );
}

/** One scenario across every target. */
export function MatrixRow({
  scenario,
  columns,
  targets,
  scenarioRuns,
  ...handlers
}: RunLineHandlers & {
  scenario: ScenarioLine;
  columns: string;
  targets: BatchTarget[];
  scenarioRuns: ScenarioRunData[];
}) {
  return (
    <Box
      display="grid"
      gridTemplateColumns={columns}
      columnGap={3}
      alignItems="start"
      paddingX={4}
      paddingY="10px"
      data-testid={`comparison-row-${scenario.scenarioId}`}
    >
      <Text fontSize="12.5px" fontWeight="medium" color="fg" paddingTop="5px" truncate>
        {scenario.name}
      </Text>

      {targets.map((target) => (
        <MatrixCell
          key={target.key}
          scenario={scenario}
          target={target}
          scenarioRuns={scenarioRuns}
          {...handlers}
        />
      ))}
    </Box>
  );
}
