import { Card } from "@langwatch/design-system/card";
import { Badge, Box, HStack, SimpleGrid, Text } from "@langwatch/design-system/primitives";
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
import { AgentPostureBadge } from "./agent-posture-badge";
import type { AgentRowExtras } from "./agent-row-extras";
import { AGENT_SOURCE_LABELS } from "./agent-rows";

/**
 * One agent as a card, the page's optional layout. Figures go through `AgentFigure` like the list;
 * unknown is "No data" with a reason, never zero. `sample` is required on invented cards.
 * @see specs/ai-governance/dashboard/agents-page.feature
 */
export function AgentCard({
  agent,
  sample = false,
  extras,
}: {
  agent: GovernanceAgentRow;
  sample?: boolean;
  extras?: AgentRowExtras;
}) {
  const added = extras?.(agent);
  return (
    <Card variant="showcase" data-testid="governance-agent-card" padding="md" bodyLayout="spaced">
      <HStack gap={2} align="baseline" wrap="wrap">
        <Text fontWeight="semibold">{agent.name}</Text>
        <AgentEnvironment environment={agent.environment} />
        {added?.status}
        <Box flex="1" />
        <AgentPostureBadge posture={agent.posture} />
        <Badge size="xs" variant="subtle" colorPalette="purple">
          {AGENT_SOURCE_LABELS[agent.source]}
        </Badge>
        {sample && (
          <Badge size="xs" variant="subtle" colorPalette="gray">
            sample
          </Badge>
        )}
        {added?.actions}
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
    </Card>
  );
}
