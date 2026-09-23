import { HStack, Text, VStack } from "@chakra-ui/react";

import {
  GovernanceSummaryCard,
  GovernanceSummaryCards,
  GovernanceSummaryRankRow,
  GovernanceSummaryStatusRow,
} from "../../ui/elements/governance-summary-cards.tsx";
import { GovernanceSummarySparkline } from "../../ui/elements/governance-summary-sparkline.tsx";
import type { AgentFleetSummary, AgentStatusLine } from "./agent-summary";

/**
 * A card that lists counted states, shared by Health and Ownership: they differ only in heading and
 * test id, so a change to one reaches both.
 */
function AgentStatusLaneCard({
  eyebrow,
  testId,
  lines,
}: {
  eyebrow: string;
  testId: string;
  lines: AgentStatusLine[];
}) {
  return (
    <GovernanceSummaryCard eyebrow={eyebrow} testId={testId}>
      <VStack align="stretch" gap={1}>
        {lines.map((line) => (
          <GovernanceSummaryStatusRow
            key={line.key}
            tone={line.tone}
            value={line.count}
            label={line.label}
          />
        ))}
      </VStack>
    </GovernanceSummaryCard>
  );
}

/**
 * The four cards the Agents page opens with. Placement only: `summarizeAgentFleet` derives and
 * words every figure, and the page decides when the strip is absent. Built on the shared summary
 * cards.
 * @see specs/ai-governance/dashboard/agents-page.feature
 */
export function AgentFleetSummaryStrip({ summary }: { summary: AgentFleetSummary }) {
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

      <AgentStatusLaneCard eyebrow="Health" testId="agents-summary-health" lines={health} />

      <AgentStatusLaneCard
        eyebrow="Ownership"
        testId="agents-summary-ownership"
        lines={ownership}
      />

      <GovernanceSummaryCard eyebrow="Top spenders" testId="agents-summary-top-spenders">
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
