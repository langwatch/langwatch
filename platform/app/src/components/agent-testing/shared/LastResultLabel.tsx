/**
 * What the last run of a scenario said, in one line: "Passed (3/3)".
 *
 * The verdict carries its own dot rather than an icon, so a column of rows
 * reads as one line of coloured text and the counts line up.
 *
 * A case that never ran says so, and a case that is running right now shows a
 * spinner instead of a verdict it does not have yet.
 *
 * The verdict is the one the run stores. A run that met every criterion and
 * failed a required evaluator reads "Failed" with a full criteria count, and
 * hovering it names the evaluator that failed it.
 */
import { Badge, Box, HStack, Spinner, Text } from "@chakra-ui/react";
import { SCENARIO_RUN_STATUS_CONFIG } from "~/components/simulations/scenario-run-status-config";
import { formatRunStatusLabel } from "~/components/suites/format-run-status-label";
import type { ScenarioRunStatus } from "~/server/scenarios/scenario-event.enums";
import {
  failedRequiredEvaluatorName,
  type RunEvaluation,
} from "../results/evaluation-summaries";

export type LastResultCriteria = {
  metCriteria: string[];
  unmetCriteria: string[];
  /** The evaluators that ran on the scenario, when any did. */
  evaluations?: RunEvaluation[] | null;
};

export type LastResultLabelProps = {
  /** The status of the last run, or nothing when the case never ran. */
  status?: ScenarioRunStatus | null;
  /** The criteria the judge read, which give the "(3/3)" count. */
  results?: LastResultCriteria | null;
  /** What a case that never ran says. */
  notRunLabel?: string;
};

export function LastResultLabel({
  status,
  results,
  notRunLabel = "Not run",
}: LastResultLabelProps) {
  if (!status) {
    return (
      <Badge size="xs" variant="subtle" colorPalette="gray">
        {notRunLabel}
      </Badge>
    );
  }

  const config = SCENARIO_RUN_STATUS_CONFIG[status];
  const label = formatRunStatusLabel({ status, results });
  const failedEvaluator = results?.evaluations
    ? failedRequiredEvaluatorName(results.evaluations)
    : null;
  const title = failedEvaluator ? `Failed · ${failedEvaluator}` : undefined;

  if (!config.isComplete) {
    return (
      <HStack gap={1.5}>
        <Spinner size="xs" color={config.fgColor} />
        <Text fontSize="12px" fontWeight="medium" color={config.fgColor}>
          {label}
        </Text>
      </HStack>
    );
  }

  return (
    <HStack gap={1.5} whiteSpace="nowrap" title={title}>
      <Box
        width="8px"
        height="8px"
        borderRadius="full"
        background={config.fgColor}
        flexShrink={0}
      />
      <Text fontSize="12px" fontWeight="semibold" color={config.fgColor}>
        {label}
      </Text>
    </HStack>
  );
}
