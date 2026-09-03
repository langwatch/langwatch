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
 * The rows and the cells live in `ComparisonResultsRow` and the column widths
 * in `comparison-columns`; this file owns the grid: which scenarios are rows
 * and which targets are columns. The matrix scrolls sideways inside its own
 * card once the columns do not fit, so the page itself never does.
 *
 * @see specs/features/agent-testing/comparison-mode.feature
 */

import { Box, Text } from "@chakra-ui/react";
import { RunMetricsSummary } from "@langwatch/suite-web";
import type { ScenarioRunData } from "@langwatch/scenario-contract";
import { FG_MUTED, TABLE_HEADER_BG } from "../../../../model/agent-testing/shared/design";
import { TargetLegend } from "../../../elements/agent-testing/shared/target-dot";
import { MatrixRow, type RunLineHandlers, type ScenarioLine } from "./comparison-results-row";
import { comparisonColumns } from "./comparison-columns";
import { type BatchTarget, summaryOfTarget } from "./use-batch-targets";

export type ComparisonResultsTableProps = RunLineHandlers & {
  scenarioRuns: ScenarioRunData[];
  targets: BatchTarget[];
};

/** The scenarios of the run, in the order the runs first name them. */
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
      <TargetLegend color={target.color} label={target.label} fontSize="11.5px" isWrapped />
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
        <TargetColumnHeader key={target.key} target={target} scenarioRuns={scenarioRuns} />
      ))}
    </Box>
  );
}

export function ComparisonResultsTable(props: ComparisonResultsTableProps) {
  const { scenarioRuns, targets } = props;
  const scenarios = scenariosOf(scenarioRuns);
  const { template: columns, minWidth } = comparisonColumns(targets);

  return (
    <Box
      borderWidth="1px"
      borderColor="border"
      borderRadius="xl"
      overflowX="auto"
      data-testid="comparison-results-table"
    >
      <Box minWidth={minWidth}>
        <MatrixHeader columns={columns} targets={targets} scenarioRuns={scenarioRuns} />

        <Box
          css={{
            "& > * + *": {
              borderTopWidth: "1px",
              borderTopColor: "var(--chakra-colors-border-muted)",
            },
          }}
        >
          {scenarios.map((scenario) => (
            <MatrixRow key={scenario.scenarioId} scenario={scenario} columns={columns} {...props} />
          ))}
        </Box>
      </Box>
    </Box>
  );
}
