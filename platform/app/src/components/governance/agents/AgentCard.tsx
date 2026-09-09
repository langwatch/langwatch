import { Badge, Box, HStack, SimpleGrid, Text, VStack } from "@chakra-ui/react";

import {
  AGENT_NEVER_RUN,
  AgentFigure,
  agentCostMissingReason,
  formatAgentCost,
  formatAgentLastActive,
  formatAgentRequests,
} from "./AgentFigure";
import { AGENT_SOURCE_LABELS, type GovernanceAgentRow } from "./agentRows";

/**
 * One agent, as a card: what it is called, where it runs, who owns it, what it
 * runs on, where we found it, and the three figures an admin came to the page
 * for.
 *
 * This is the page's optional layout; the list is the default. A card spends a
 * lot of width on one agent, which is the right trade when the reader is
 * looking at one and the wrong one when they are comparing ten. Both layouts
 * draw their figures through `AgentFigure`, so neither can format a number or
 * word a dash differently from the other.
 *
 * A figure we do not have renders as a dash with a reason on hover, never as
 * zero. `$0.00` is a measurement — it says the agent ran and spent nothing —
 * and an agent that has never been called has not earned that claim.
 *
 * `sample` is not optional on an invented card. A badge on the panel would be
 * a claim about the screen; this is a claim about the row, and the rows are
 * what a reader quotes.
 *
 * Spec: specs/ai-governance/dashboard/agents-page.feature
 */
export function AgentCard({
  agent,
  sample = false,
}: {
  agent: GovernanceAgentRow;
  sample?: boolean;
}) {
  return (
    <VStack
      data-testid="governance-agent-card"
      align="stretch"
      gap={3}
      borderWidth="1px"
      borderColor="border.subtle"
      borderRadius="lg"
      backgroundColor="bg.panel"
      padding={4}
    >
      <HStack gap={2} align="baseline" wrap="wrap">
        <Text fontWeight="semibold">{agent.name}</Text>
        <Text textStyle="sm" color="fg.muted">
          {agent.environment}
        </Text>
        <Box flex="1" />
        <Badge size="xs" variant="subtle" colorPalette="purple">
          {AGENT_SOURCE_LABELS[agent.source]}
        </Badge>
        {sample && (
          <Badge size="xs" variant="subtle" colorPalette="gray">
            sample
          </Badge>
        )}
      </HStack>

      <HStack gap={2} wrap="wrap">
        {agent.owner === null ? (
          <Badge size="xs" variant="subtle" colorPalette="orange">
            Unclaimed
          </Badge>
        ) : (
          <Text textStyle="sm" color="fg.muted">
            {agent.owner}
          </Text>
        )}
        {agent.models.map((model) => (
          <Badge key={model} size="xs" variant="outline" colorPalette="gray">
            {model}
          </Badge>
        ))}
      </HStack>

      <SimpleGrid columns={3} gap={3}>
        <AgentFigure
          label="Cost · 30 days"
          missingReason={agentCostMissingReason(agent)}
          value={formatAgentCost(agent)}
        />
        <AgentFigure
          label="Requests · 30 days"
          value={formatAgentRequests(agent)}
        />
        <AgentFigure
          label="Last active"
          value={formatAgentLastActive(agent)}
          missingReason={AGENT_NEVER_RUN}
        />
      </SimpleGrid>
    </VStack>
  );
}
