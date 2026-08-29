/**
 * The results of a comparison run as a matrix: one row per scenario, one
 * column per target, and in each cell how that scenario went against that
 * target.
 *
 * The columns put the targets next to each other, which is what a comparison
 * is for. Each column header carries the dot and the name of its target and
 * the summary of that target's runs alone, so the two pills sit side by side
 * where the single run reads one pill in its header line.
 *
 * A cell stacks one line per run of its scenario and target, so a run that
 * repeated reads three verdicts rather than one. Each line opens the same run
 * drawer a row of the single-target table opens, which is where rerun and
 * the editor live, so the rows carry no menu of their own. A scenario the
 * run never went against with a target says so in that cell.
 *
 * The matrix scrolls sideways inside its own card once the columns do not
 * fit, so the page itself never does.
 *
 * @see specs/features/agent-testing/comparison-mode.feature
 */

import { Box, Button, chakra, HStack, Spinner, Text } from "@chakra-ui/react";
import { Square } from "lucide-react";
import { RunMetricsSummary } from "~/components/suites/RunMetricsSummary";
import { isCancellableStatus } from "~/components/suites/useCancelScenarioRun";
import { isTerminalStatus } from "~/server/scenarios/scenario-event.enums";
import type { ScenarioRunData } from "~/server/scenarios/scenario-event.types";
import { FG_MUTED, ROW_HOVER_BG, TABLE_HEADER_BG } from "../shared/design";
import { LastResultLabel } from "../shared/LastResultLabel";
import { ResultMetricsInline } from "../shared/ResultMetricsInline";
import { TargetLegend } from "../shared/TargetDot";
import {
  type BatchTarget,
  runsOfTarget,
  summaryOfTarget,
} from "./useBatchTargets";

/** What a cell reads when the run never went against that target. */
export const NOT_IN_RUN_LABEL = "not in run";

const SCENARIO_COLUMN_WIDTH = 200;
const TARGET_COLUMN_WIDTH = 220;

export type ComparisonResultsTableProps = {
  scenarioRuns: ScenarioRunData[];
  targets: BatchTarget[];
  onScenarioRunClick: (scenarioRun: ScenarioRunData) => void;
  /** Absent when the person may not stop runs, or when the set is not ours. */
  onCancelRun?: (scenarioRun: ScenarioRunData) => void;
  cancellingJobId?: string | null;
};

/** One scenario of the run, in the order the runs first name it. */
type ScenarioLine = { scenarioId: string; name: string };

function scenariosOf(scenarioRuns: ScenarioRunData[]): ScenarioLine[] {
  const seen = new Map<string, ScenarioLine>();
  for (const run of scenarioRuns) {
    if (seen.has(run.scenarioId)) continue;
    seen.set(run.scenarioId, {
      scenarioId: run.scenarioId,
      name: run.name ?? run.scenarioId,
    });
  }
  return [...seen.values()];
}

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
    .sort((left, right) =>
      left.scenarioRunId.localeCompare(right.scenarioRunId),
    );
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
}: Pick<
  ComparisonResultsTableProps,
  "onScenarioRunClick" | "onCancelRun" | "cancellingJobId"
> & { scenarioRun: ScenarioRunData }) {
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
        <LastResultLabel
          status={scenarioRun.status}
          results={scenarioRun.results ?? undefined}
        />
        {isSettled ? (
          <ResultMetricsInline
            durationInMs={
              scenarioRun.durationInMs > 0 ? scenarioRun.durationInMs : null
            }
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

/** The header of one target column: its mark, its name and its own summary. */
function TargetColumnHeader({
  target,
  scenarioRuns,
}: {
  target: BatchTarget;
  scenarioRuns: ScenarioRunData[];
}) {
  const summary = summaryOfTarget({ scenarioRuns, target });

  return (
    <Box
      minWidth={0}
      display="flex"
      flexDirection="column"
      alignItems="flex-start"
      gap={1.5}
      textTransform="none"
      letterSpacing="normal"
      data-testid={`comparison-column-${target.key}`}
    >
      <TargetLegend
        color={target.color}
        label={target.label}
        fontSize="11.5px"
      />
      <RunMetricsSummary summary={summary} size="sm" />
    </Box>
  );
}

/** The line above the matrix: "Scenario", then one header per target. */
function MatrixHeader({
  columns,
  targets,
  scenarioRuns,
}: {
  columns: string;
  targets: BatchTarget[];
  scenarioRuns: ScenarioRunData[];
}) {
  return (
    <Box
      display="grid"
      gridTemplateColumns={columns}
      columnGap={3}
      alignItems="flex-start"
      paddingX={4}
      paddingY={2.5}
      background={TABLE_HEADER_BG}
      borderBottomWidth="1px"
      borderBottomColor="border"
      fontSize="10.5px"
      fontWeight="semibold"
      textTransform="uppercase"
      letterSpacing="0.025em"
      color={FG_MUTED}
    >
      <Text as="span" paddingTop="2px">
        Scenario
      </Text>
      {targets.map((target) => (
        <TargetColumnHeader
          key={target.key}
          target={target}
          scenarioRuns={scenarioRuns}
        />
      ))}
    </Box>
  );
}

/** One scenario across every target. */
function MatrixRow({
  scenario,
  columns,
  targets,
  scenarioRuns,
  ...handlers
}: Pick<
  ComparisonResultsTableProps,
  | "targets"
  | "scenarioRuns"
  | "onScenarioRunClick"
  | "onCancelRun"
  | "cancellingJobId"
> & { scenario: ScenarioLine; columns: string }) {
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
      <Text
        fontSize="12.5px"
        fontWeight="medium"
        color="fg"
        paddingTop="5px"
        truncate
      >
        {scenario.name}
      </Text>

      {targets.map((target) => {
        const runs = cellRuns({
          scenarioRuns,
          scenarioId: scenario.scenarioId,
          target,
        });
        return (
          <Box
            key={target.key}
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
                <RunLine
                  key={scenarioRun.scenarioRunId}
                  scenarioRun={scenarioRun}
                  {...handlers}
                />
              ))
            )}
          </Box>
        );
      })}
    </Box>
  );
}

export function ComparisonResultsTable(props: ComparisonResultsTableProps) {
  const { scenarioRuns, targets } = props;
  const scenarios = scenariosOf(scenarioRuns);
  const columns = `minmax(${SCENARIO_COLUMN_WIDTH}px, 1.2fr) repeat(${targets.length}, minmax(${TARGET_COLUMN_WIDTH}px, 1fr))`;
  const minWidth = `${SCENARIO_COLUMN_WIDTH + targets.length * TARGET_COLUMN_WIDTH}px`;

  return (
    <Box
      borderWidth="1px"
      borderColor="border"
      borderRadius="xl"
      overflowX="auto"
      data-testid="comparison-results-table"
    >
      <Box minWidth={minWidth}>
        <MatrixHeader
          columns={columns}
          targets={targets}
          scenarioRuns={scenarioRuns}
        />

        <Box
          css={{
            "& > * + *": {
              borderTopWidth: "1px",
              borderTopColor: "var(--chakra-colors-border-muted)",
            },
          }}
        >
          {scenarios.map((scenario) => (
            <MatrixRow
              key={scenario.scenarioId}
              scenario={scenario}
              columns={columns}
              {...props}
            />
          ))}
        </Box>
      </Box>
    </Box>
  );
}
