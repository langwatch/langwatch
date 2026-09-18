/**
 * What the last run of a scenario said, in one line: "Passed (3/3)". The
 * verdict's own dot replaces an icon, so a column of rows reads as coloured
 * text. Met-every-criterion-but-failed-required reads "Failed"; hover names it.
 */
import { Badge, Box, HStack, Spinner, Text } from "@chakra-ui/react";
import type { ScenarioRunStatus } from "@langwatch/scenario-contract";
import { formatRunStatusLabel } from "@langwatch/suite-browser-kit";

import { SCENARIO_RUN_STATUS_CONFIG } from "../../../../model/scenario-run-status-config.ts";
import {
  failedRequiredEvaluatorName,
  type RunEvaluation,
} from "../../../sections/agent-testing/results/evaluation-summaries.ts";

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
