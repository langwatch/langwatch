import { HStack, Text, VStack } from "@chakra-ui/react";

import {
  GovernanceSummaryCard,
  GovernanceSummaryCards,
  GovernanceSummaryRankRow,
  GovernanceSummarySparkline,
  GovernanceSummaryStatusRow,
} from "~/components/governance/summary";

import type { AgentFleetSummary } from "./agentSummary";

/**
 * The four cards the Agents page opens with: how many agents there are, how
 * they are doing, who owns them, and where the money goes.
 *
 * PLACEMENT ONLY. Every figure arrives already derived and already worded by
 * `summarizeAgentFleet`, so there is nothing to assert about this file that
 * the unit test next to that function does not already assert without
 * rendering. What is left here is which figure goes in which card.
 *
 * THE SHAPE IS BORROWED, DELIBERATELY. The cards, the eyebrow, the status row
 * and the rank row all come from `~/components/governance/summary`, which was
 * built once for the several governance pages that needed a resume in the same
 * round. This page inventing its own would be the exact mistake that left the
 * section with five separate sample badges.
 *
 * WHEN IT IS NOT RENDERED. The page decides that, not this component — see
 * `AgentsPage`. Briefly: with nothing to summarize it is absent rather than
 * showing four em dashes, because zero agents responding and no agents at all
 * are different facts.
 *
 * Spec: specs/ai-governance/dashboard/agents-page.feature
 */
export function AgentFleetSummaryStrip({
  summary,
}: {
  summary: AgentFleetSummary;
}) {
  const { fleet, health, ownership, topSpenders } = summary;

  return (
    <GovernanceSummaryCards testId="agents-summary-strip">
      <GovernanceSummaryCard eyebrow="Fleet" testId="agents-summary-fleet">
        {/* The count and the line share a row: the number is the answer and
            the line is the shape of how it got there, so putting the line
            below the caption would separate it from the thing it describes. */}
        <HStack justify="space-between" align="center" gap={3}>
          <HStack gap={1.5} alignItems="baseline">
            <Text
              fontSize="2xl"
              fontWeight="semibold"
              fontVariantNumeric="tabular-nums"
              lineHeight="1.1"
              color="fg"
            >
              {fleet.count}
            </Text>
            <Text fontSize="sm" color="fg.muted">
              {fleet.unit}
            </Text>
          </HStack>
          <GovernanceSummarySparkline
            points={fleet.registrations}
            label={fleet.registrationsLabel}
          />
        </HStack>
        <Text fontSize="xs" color="fg.subtle">
          {fleet.caption}
        </Text>
      </GovernanceSummaryCard>

      <GovernanceSummaryCard eyebrow="Health" testId="agents-summary-health">
        <VStack align="stretch" gap={1}>
          {health.map((line) => (
            <GovernanceSummaryStatusRow
              key={line.key}
              tone={line.tone}
              value={line.count}
              label={line.label}
            />
          ))}
        </VStack>
      </GovernanceSummaryCard>

      <GovernanceSummaryCard
        eyebrow="Ownership"
        testId="agents-summary-ownership"
      >
        <VStack align="stretch" gap={1}>
          {ownership.map((line) => (
            <GovernanceSummaryStatusRow
              key={line.key}
              tone={line.tone}
              value={line.count}
              label={line.label}
            />
          ))}
        </VStack>
      </GovernanceSummaryCard>

      <GovernanceSummaryCard
        eyebrow="Top spenders"
        testId="agents-summary-top-spenders"
      >
        <VStack align="stretch" gap={1}>
          {topSpenders.length === 0 ? (
            // A fleet exists and none of its spend has been measured. Not an
            // empty ranking drawn as three em dashes: there is nothing to rank
            // and saying so is shorter than pretending there is.
            <Text fontSize="sm" color="fg.muted">
              No spend measured yet
            </Text>
          ) : (
            topSpenders.map((agent) => (
              <GovernanceSummaryRankRow
                key={agent.key}
                label={agent.name}
                value={agent.shareLabel}
              />
            ))
          )}
        </VStack>
      </GovernanceSummaryCard>
    </GovernanceSummaryCards>
  );
}
