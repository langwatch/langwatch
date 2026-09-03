/**
 * The results of one run as a table: one row per scenario and target pair,
 * with the verdict, the duration and the cost.
 *
 * The table is a grid inside one bordered card, the way the Scenarios table
 * is drawn, so both tabs read as one surface.
 *
 * A row that is still going can be stopped on its own. A row that finished
 * carries no Stop control. The time and the cost are only read once the run
 * has settled: a run that just started has neither.
 *
 * @see specs/features/agent-testing/results-tabs.feature
 */

import { Box, Text } from "@chakra-ui/react";
import { isCancellableStatus } from "../../../../behavior/suites/use-cancel-scenario-run";
import type { ScenarioRunData } from "@langwatch/scenario-contract";
import { FG_MUTED, TABLE_HEADER_BG } from "../../../../model/agent-testing/shared/design";
import { RunResultRow } from "./run-result-row";

/**
 * The columns of the table. The last one holds the row menu, and grows to fit
 * a Stop control while the run still has one to offer.
 */
const RESULT_COLUMNS = "120px minmax(0,1fr) minmax(220px,auto) 130px auto";

export type RunResultsTableProps = {
  scenarioRuns: ScenarioRunData[];
  resolveTargetName: (scenarioRun: ScenarioRunData) => string | null;
  iterationMap: Map<string, number>;
  onScenarioRunClick: (scenarioRun: ScenarioRunData) => void;
  /** Absent when the person may not stop runs, or when the set is not ours. */
  onCancelRun?: (scenarioRun: ScenarioRunData) => void;
  cancellingJobId?: string | null;
  /** Opens the editor of the scenario the row ran. */
  onEditCase?: (scenarioRun: ScenarioRunData) => void;
  /** Runs the scenario the row ran again, on its own. */
  onRerunCase?: (scenarioRun: ScenarioRunData) => void;
};

export function RunResultsTable({
  scenarioRuns,
  resolveTargetName,
  iterationMap,
  onScenarioRunClick,
  onCancelRun,
  cancellingJobId,
  onEditCase,
  onRerunCase,
}: RunResultsTableProps) {
  const hasStoppable =
    !!onCancelRun && scenarioRuns.some((scenarioRun) => isCancellableStatus(scenarioRun.status));

  return (
    <Box
      borderWidth="1px"
      borderColor="border"
      borderRadius="xl"
      overflowX="auto"
      data-testid="run-results-table"
    >
      <Box
        display="grid"
        gridTemplateColumns={RESULT_COLUMNS}
        columnGap={3}
        alignItems="center"
        paddingX={4}
        paddingY={2}
        background={TABLE_HEADER_BG}
        borderBottomWidth="1px"
        borderBottomColor="border"
        fontSize="10.5px"
        fontWeight="semibold"
        textTransform="uppercase"
        letterSpacing="0.025em"
        color={FG_MUTED}
      >
        <Text as="span">Result</Text>
        <Text as="span">Scenario</Text>
        <Text as="span">Evaluators</Text>
        <Text as="span" textAlign="right">
          Time · cost
        </Text>
        <Text as="span" />
      </Box>

      <Box
        css={{
          "& > * + *": {
            borderTopWidth: "1px",
            borderTopColor: "var(--chakra-colors-border-muted)",
          },
        }}
      >
        {scenarioRuns.map((scenarioRun) => (
          <RunResultRow
            key={scenarioRun.scenarioRunId}
            scenarioRun={scenarioRun}
            templateColumns={RESULT_COLUMNS}
            hasStoppable={hasStoppable}
            resolveTargetName={resolveTargetName}
            iterationMap={iterationMap}
            onScenarioRunClick={onScenarioRunClick}
            onCancelRun={onCancelRun}
            cancellingJobId={cancellingJobId}
            onEditCase={onEditCase}
            onRerunCase={onRerunCase}
          />
        ))}
      </Box>
    </Box>
  );
}
