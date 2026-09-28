import { Box, Text, VStack } from "@chakra-ui/react";
import {
  resolveCriterionResults,
  type ScenarioCriterionResult,
  type ScenarioCriterionStatus,
  type SimulationRunResult as ScenarioResults,
} from "@langwatch/scenario-contract";

import {
  CONSOLE_COLORS,
  REASONING_VERDICT_COLOR_MAP,
} from "../../../model/simulation-console/constants.ts";

type ConsoleColor = (typeof CONSOLE_COLORS)[string] | undefined;

interface CriteriaDetailsProps {
  results?: ScenarioResults | null;
}

const CRITERIA_GROUPS: readonly {
  status: ScenarioCriterionStatus;
  title: string;
  mark: string;
  color: ConsoleColor;
}[] = [
  { status: "passed", title: "Met Criteria", mark: "✓", color: CONSOLE_COLORS.successColor },
  { status: "failed", title: "Unmet Criteria", mark: "✗", color: CONSOLE_COLORS.failureColor },
  {
    status: "inconclusive",
    title: "Could Not Check",
    mark: "?",
    color: CONSOLE_COLORS.warningColor,
  },
];

function CriteriaGroup({
  title,
  mark,
  color,
  criteria,
}: {
  title: string;
  mark: string;
  color: ConsoleColor;
  criteria: readonly ScenarioCriterionResult[];
}) {
  if (criteria.length === 0) return null;
  return (
    <Box>
      <Text color={color} fontWeight="semibold" mb={1}>
        {mark} {title} ({criteria.length}):
      </Text>
      <VStack align="start" gap={1} pl={2}>
        {criteria.map((result, idx) => (
          <Box key={idx}>
            <Text color={color} fontSize="sm">
              • {result.criterion}
            </Text>
            {result.reasoning ? (
              <Text color={CONSOLE_COLORS.consoleText} fontSize="xs" pl={3} whiteSpace="pre-wrap">
                {result.reasoning}
              </Text>
            ) : null}
          </Box>
        ))}
      </VStack>
    </Box>
  );
}

export function CriteriaDetails({ results }: CriteriaDetailsProps) {
  if (!results) return null;
  const criteria = resolveCriterionResults({
    criteria: results.criteria,
    metCriteria: results.metCriteria ?? [],
    unmetCriteria: results.unmetCriteria ?? [],
    inconclusiveCriteria: results.inconclusiveCriteria,
  });

  return (
    <VStack align="start" gap={3} pl={4}>
      {CRITERIA_GROUPS.map((group) => (
        <CriteriaGroup
          key={group.status}
          title={group.title}
          mark={group.mark}
          color={group.color}
          criteria={criteria.filter((result) => result.status === group.status)}
        />
      ))}

      {results.reasoning && (
        <Box>
          <Text color="white" fontWeight="semibold" mb={1}>
            Reasoning:
          </Text>
          <Text
            color={REASONING_VERDICT_COLOR_MAP[results.verdict]}
            fontSize="sm"
            pl={2}
            whiteSpace="pre-wrap"
            fontWeight="bold"
          >
            {results.reasoning}
          </Text>
        </Box>
      )}
    </VStack>
  );
}
