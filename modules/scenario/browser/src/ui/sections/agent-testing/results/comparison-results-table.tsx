/**
 * The results of a comparison run as a matrix: one row per scenario, one column per
 * target, and in each cell how that scenario went against that target.
 * @see specs/features/agent-testing/comparison-mode.feature
 */

import { ListTable } from "@langwatch/design-system/list-table";
import { Box, Table } from "@langwatch/design-system/primitives";
import type { ScenarioRunData } from "@langwatch/scenario-contract";

import { TargetLegend } from "../../../elements/agent-testing/shared/target-dot.tsx";
import { RunMetricsSummary } from "../../../elements/suite/runs/run-metrics-summary.tsx";
import { comparisonColumns } from "./comparison-columns.ts";
import { MatrixRow, type RunLineHandlers, type ScenarioLine } from "./comparison-results-row.tsx";
import { type BatchTarget, summaryOfTarget } from "./use-batch-targets.ts";

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
      data-testid={`comparison-column-${target.key}`}
    >
      <TargetLegend color={target.color} label={target.label} textStyle="caption" isWrapped />
      <RunMetricsSummary summary={summary} size="sm" />
    </Box>
  );
}

/** The line above the matrix: "Scenario", then one header per target. */
function MatrixHeader({
  targets,
  scenarioRuns,
}: {
  targets: BatchTarget[];
  scenarioRuns: ScenarioRunData[];
}) {
  return (
    <Table.Header>
      <Table.Row
        // A target header carries a summary and wraps its label, so it outgrows the band.
        css={{
          "&& > th": {
            verticalAlign: "top",
            height: "auto",
            paddingY: "2.5",
            whiteSpace: "normal",
          },
        }}
      >
        <Table.ColumnHeader>
          <Box paddingTop="0.5">Scenario</Box>
        </Table.ColumnHeader>
        {targets.map((target) => (
          <Table.ColumnHeader key={target.key}>
            <TargetColumnHeader target={target} scenarioRuns={scenarioRuns} />
          </Table.ColumnHeader>
        ))}
      </Table.Row>
    </Table.Header>
  );
}

export function ComparisonResultsTable(props: ComparisonResultsTableProps) {
  const { scenarioRuns, targets } = props;
  const scenarios = scenariosOf(scenarioRuns);
  const { scenarioWidth, targetWidth, minWidth } = comparisonColumns(targets);

  return (
    <ListTable
      tableLayout="fixed"
      minWidth={minWidth}
      containerProps={{ overflowX: "auto" }}
      data-testid="comparison-results-table"
    >
      <Table.ColumnGroup>
        <Table.Column width={scenarioWidth} data-column="scenario" />
        {targets.map((target) => (
          <Table.Column key={target.key} width={targetWidth} data-column={target.key} />
        ))}
      </Table.ColumnGroup>

      <MatrixHeader targets={targets} scenarioRuns={scenarioRuns} />

      <ListTable.Body>
        {scenarios.map((scenario) => (
          <MatrixRow key={scenario.scenarioId} scenario={scenario} {...props} />
        ))}
      </ListTable.Body>
    </ListTable>
  );
}
