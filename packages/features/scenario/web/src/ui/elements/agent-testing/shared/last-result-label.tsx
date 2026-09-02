/**
 * What the last run of a test case said, in one line: "Passed (3/3)".
 *
 * The verdict carries its own dot rather than an icon, so a column of rows
 * reads as one line of coloured text and the counts line up.
 *
 * A case that never ran says so, and a case that is running right now shows a
 * spinner instead of a verdict it does not have yet.
 */
import { Badge, Box, HStack, Spinner, Text } from "@chakra-ui/react";
import { SCENARIO_RUN_STATUS_CONFIG } from "../../../../index";
import { formatRunStatusLabel } from "@langwatch/suite-web";
import type { ScenarioRunStatus } from "@langwatch/scenario-contract";

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
        <Text fontSize="12px" fontWeight="medium" color={config.fgColor}>
          {label}
        </Text>
      </HStack>
    );
  }

  return (
    <HStack gap={1.5} whiteSpace="nowrap">
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
