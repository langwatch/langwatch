import { Badge, Box, HStack, SimpleGrid, Text, VStack } from "@chakra-ui/react";
import numeral from "numeral";

import { Tooltip } from "~/components/ui/tooltip";

import {
  AGENT_SOURCE_LABELS,
  formatLastActive,
  type GovernanceAgentRow,
} from "./agentRows";

/**
 * One agent, as a card: what it is called, where it runs, who owns it, what it
 * runs on, where we found it, and the three figures an admin came to the page
 * for.
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
          missingReason={
            agent.source === "copilot_studio"
              ? "Dollar cost per agent needs billing data and a supported calculation."
              : "The platform has not measured this yet."
          }
          value={
            agent.costUsd30d === null
              ? null
              : numeral(agent.costUsd30d).format("$0,0.00")
          }
        />
        <AgentFigure
          label="Requests · 30 days"
          value={
            agent.requests30d === null
              ? null
              : numeral(agent.requests30d).format("0,0")
          }
        />
        <AgentFigure
          label="Last active"
          value={formatLastActive(agent.lastActiveMinutesAgo)}
          missingReason="This agent has registered but has never run."
        />
      </SimpleGrid>
    </VStack>
  );
}

/**
 * One figure and its label. `null` is the only way a figure goes missing, and
 * it always renders the same way, so a reader learns the dash once.
 */
function AgentFigure({
  label,
  value,
  missingReason = "The platform has not measured this yet.",
}: {
  label: string;
  value: string | null;
  missingReason?: string;
}) {
  return (
    <VStack align="start" gap={0.5}>
      <Text textStyle="xs" color="fg.muted">
        {label}
      </Text>
      {value === null ? (
        <Tooltip content={missingReason}>
          <Text textStyle="sm" color="fg.muted" aria-label={missingReason}>
            —
          </Text>
        </Tooltip>
      ) : (
        <Text textStyle="sm" fontWeight="medium">
          {value}
        </Text>
      )}
    </VStack>
  );
}
