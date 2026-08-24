/**
 * What the last run of a test case said, in one line: "Passed (3/3)".
 *
 * A case that never ran says so, and a case that is running right now shows a
 * spinner instead of a verdict it does not have yet.
 */
import { Badge, HStack, Spinner, Text } from "@chakra-ui/react";
import { ScenarioRunStatusIcon } from "~/components/simulations/ScenarioRunStatusIcon";
import { SCENARIO_RUN_STATUS_CONFIG } from "~/components/simulations/scenario-run-status-config";
import { formatRunStatusLabel } from "~/components/suites/format-run-status-label";
import type { ScenarioRunStatus } from "~/server/scenarios/scenario-event.enums";

export type LastResultCriteria = {
  metCriteria: string[];
  unmetCriteria: string[];
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

  if (!config.isComplete) {
    return (
      <HStack gap={1.5}>
        <Spinner size="xs" color={config.fgColor} />
        <Text fontSize="sm" color={config.fgColor}>
          {label}
        </Text>
      </HStack>
    );
  }

  return (
    <HStack gap={1.5}>
      <ScenarioRunStatusIcon status={status} boxSize="14px" />
      <Text fontSize="sm" color={config.fgColor}>
        {label}
      </Text>
    </HStack>
  );
}
