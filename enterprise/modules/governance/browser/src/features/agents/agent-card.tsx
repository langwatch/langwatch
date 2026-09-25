import { Badge, Box, HStack, SimpleGrid, Text, VStack } from "@chakra-ui/react";
import { type GovernanceAgentRow } from "@langwatch/enterprise-governance-contract";

import {
  AGENT_NEVER_RUN,
  AgentEnvironment,
  AgentFigure,
  agentCostMissingReason,
  formatAgentCost,
  formatAgentLastActive,
  formatAgentRequests,
} from "./agent-figure";
import { AGENT_SOURCE_LABELS } from "./agent-rows";

/**
 * One agent as a card, the page's optional layout. Figures go through `AgentFigure` like the list;
 * unknown is a dash with a reason, never zero. `sample` is required on invented cards.
 * @see specs/ai-governance/dashboard/agents-page.feature
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
        <AgentEnvironment environment={agent.environment} />
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
        <AgentFigure label="Requests · 30 days" value={formatAgentRequests(agent)} />
        <AgentFigure
          label="Last active"
          value={formatAgentLastActive(agent)}
          missingReason={AGENT_NEVER_RUN}
        />
      </SimpleGrid>
    </VStack>
  );
}
