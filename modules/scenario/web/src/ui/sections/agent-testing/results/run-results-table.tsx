/**
 * The results of one run as a table: one row per scenario and target pair, with the
 * verdict, the duration and the cost.
 * @see specs/features/agent-testing/results-tabs.feature
 */

import { Box, Text } from "@chakra-ui/react";
import { isCancellableStatus } from "../../../../behavior/suites/use-cancel-scenario-run.ts";
import type { ScenarioRunData } from "@langwatch/scenario-contract";
import { FG_MUTED, TABLE_HEADER_BG } from "../../../../model/agent-testing/shared/design.ts";
import { anyRunHasCaller } from "./caller-display.ts";
import { runHasEvaluators } from "./evaluation-summaries.ts";
import { RunResultRow } from "./run-result-row.tsx";

/**
 * The columns of the table. The last one holds the row menu, and grows to fit
 * a Stop control while the run still has one to offer.
 *
 * The Evaluators column exists only on a run that has evaluators. When it
 * does, the scenario and the evaluators share the free width and the
 * scenario keeps a readable floor, so a narrow table wraps the pills rather
 * than cutting the name.
 */
/**
 * Compose the grid template from the columns actually shown. The Caller column
 * (AC24) appears only when a run in the table has a caller — text runs never
 * add it. It sits between the scenario/evaluators columns and Time · cost.
 */
function resultColumns({
  hasEvaluators,
  hasCaller,
}: {
  hasEvaluators: boolean;
  hasCaller: boolean;
}): string {
  return [
    "120px", // Result
    hasEvaluators ? "minmax(160px,1fr)" : "minmax(0,1fr)", // Scenario
    ...(hasEvaluators ? ["minmax(0,1fr)"] : []), // Evaluators
    ...(hasCaller ? ["90px"] : []), // Caller
    "130px", // Time · cost
    "auto", // row menu
  ].join(" ");
}

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
    !!onCancelRun &&
    scenarioRuns.some((scenarioRun) => isCancellableStatus(scenarioRun.status));
  const hasEvaluators = scenarioRuns.some(runHasEvaluators);
  const hasCaller = anyRunHasCaller(scenarioRuns);
  const templateColumns = resultColumns({ hasEvaluators, hasCaller });

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
        gridTemplateColumns={templateColumns}
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
        data-testid="run-results-table-header"
      >
        <Text as="span">Result</Text>
        <Text as="span">Scenario</Text>
        {hasEvaluators ? <Text as="span">Evaluators</Text> : null}
        {hasCaller ? <Text as="span">Caller</Text> : null}
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
            templateColumns={templateColumns}
            hasStoppable={hasStoppable}
            hasEvaluators={hasEvaluators}
            hasCaller={hasCaller}
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
