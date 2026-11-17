import { Box, HStack, Text, VStack } from "@langwatch/design-system/primitives";
import { RED_TEAM_BREAK_SCORE, type RedTeamRunReport } from "@langwatch/scenario-contract";

import { owaspCategoryLabel } from "../../model/owasp-category.ts";
import { redTeamTurnSummary } from "../../model/red-team-report.ts";
import { RedTeamOutcomeBadge } from "../elements/red-team-outcome-badge.tsx";

/** A red team run's report: outcome, OWASP ids, attack goal and the judge's score per turn. */
export function RedTeamReportPanel({ report }: { report: RedTeamRunReport }) {
  return (
    <VStack align="stretch" gap={3} data-testid="red-team-report">
      <HStack gap={2} flexWrap="wrap">
        <RedTeamOutcomeBadge outcome={report.outcome} />
        <Text fontSize="sm" color="fg.muted">
          {redTeamTurnSummary({ report })}
        </Text>
      </HStack>
      <HStack gap={1.5} flexWrap="wrap" aria-label="OWASP categories">
        {report.owaspIds.map((owaspId) => (
          <Text
            key={owaspId}
            fontSize="xs"
            fontWeight="medium"
            borderWidth="1px"
            borderColor="border"
            borderRadius="md"
            px={2}
            py={0.5}
          >
            {owaspCategoryLabel({ id: owaspId })}
          </Text>
        ))}
      </HStack>
      <VStack align="stretch" gap={0.5}>
        <Text fontSize="xs" color="fg.muted">
          Attack goal
        </Text>
        <Text fontSize="sm">{report.attackGoal}</Text>
      </VStack>
      {report.turnScores.length > 0 ? <TurnScoreList report={report} /> : null}
    </VStack>
  );
}

function TurnScoreList({ report }: { report: RedTeamRunReport }) {
  return (
    <VStack align="stretch" gap={1.5} as="ol" aria-label="Judge score per turn">
      {report.turnScores.map(({ turn, score, hint }) => {
        const isBreak = score >= RED_TEAM_BREAK_SCORE;
        return (
          <Box as="li" key={turn} listStyleType="none" data-testid={`red-team-turn-${turn}`}>
            <HStack gap={2}>
              <Text fontSize="xs" color="fg.muted" minWidth="52px">
                Turn {turn}
              </Text>
              <Box flex={1} height="6px" borderRadius="full" bg="bg.muted" overflow="hidden">
                <Box
                  height="full"
                  width={`${(score / 10) * 100}%`}
                  bg={isBreak ? "red.solid" : "fg.subtle"}
                  borderRadius="full"
                />
              </Box>
              <Text fontSize="xs" fontWeight="medium" minWidth="40px" textAlign="end">
                {score}/10
              </Text>
            </HStack>
            {hint ? (
              <Text fontSize="xs" color="fg.muted" paddingStart="60px">
                {hint}
              </Text>
            ) : null}
          </Box>
        );
      })}
    </VStack>
  );
}
