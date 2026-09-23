import { Badge, HStack, Table, Text } from "@chakra-ui/react";
import { ListTable } from "@langwatch/design-system/list-table";

import {
  AGENT_NEVER_RUN,
  AgentEnvironment,
  AgentValue,
  agentCostMissingReason,
  formatAgentCost,
  formatAgentLastActive,
  formatAgentRequests,
} from "./agent-figure";
import {
  AGENT_HEALTH_LABELS,
  AGENT_SOURCE_LABELS,
  formatRegistered,
  type GovernanceAgentRow,
} from "./agent-rows";

/**
 * The fleet as a list, the page's default: comparing agents is the question. All ten attributes,
 * spelled-out headers, health as a word; figures go through `AgentValue`, shared with the card.
 * @see specs/ai-governance/dashboard/agents-page.feature
 */

/** Every column after the agent's own name, in reading order. */
export const AGENT_TABLE_COLUMNS = [
  "Environment",
  "Owner",
  "Source",
  "Models",
  "Health",
  "Cost · 30 days",
  "Requests · 30 days",
  "Last active",
  "Registered",
] as const;

export function AgentsTable({
  agents,
  sample = false,
}: {
  agents: readonly GovernanceAgentRow[];
  sample?: boolean;
}) {
  return (
    <ListTable
      size="sm"
      data-testid="governance-agents-table"
      containerProps={{ overflowX: "auto", width: "full" }}
    >
      <Table.Header>
        <Table.Row>
          <Table.ColumnHeader>Agent</Table.ColumnHeader>
          {AGENT_TABLE_COLUMNS.map((column) => (
            <Table.ColumnHeader key={column} whiteSpace="nowrap">
              {column}
            </Table.ColumnHeader>
          ))}
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {agents.map((agent) => (
          <Table.Row key={agent.id} data-testid="governance-agent-row" data-agent={agent.name}>
            <Table.Cell whiteSpace="nowrap">
              <HStack gap={1.5}>
                <Text textStyle="sm" fontWeight="medium">
                  {agent.name}
                </Text>
                {/* The same claim the card makes, in the same place: on the
                    row, because the row is what a reader quotes. */}
                {sample && (
                  <Badge size="xs" variant="subtle" colorPalette="gray">
                    sample
                  </Badge>
                )}
              </HStack>
            </Table.Cell>

            <Table.Cell whiteSpace="nowrap">
              <AgentEnvironment environment={agent.environment} />
            </Table.Cell>

            <Table.Cell whiteSpace="nowrap">
              {/* Unclaimed is a fact about the agent, not a figure nobody
                  measured, so it is the badge the card uses and never a
                  dash. */}
              {agent.owner === null ? (
                <Badge size="xs" variant="subtle" colorPalette="orange">
                  Unclaimed
                </Badge>
              ) : (
                <Text textStyle="sm" color="fg.muted">
                  {agent.owner}
                </Text>
              )}
            </Table.Cell>

            <Table.Cell whiteSpace="nowrap">
              <Badge size="xs" variant="subtle" colorPalette="purple">
                {AGENT_SOURCE_LABELS[agent.source]}
              </Badge>
            </Table.Cell>

            <Table.Cell>
              {agent.models.length === 0 ? (
                <AgentValue value={null} />
              ) : (
                <HStack gap={1} wrap="wrap">
                  {agent.models.map((model) => (
                    <Badge key={model} size="xs" variant="outline" colorPalette="gray">
                      {model}
                    </Badge>
                  ))}
                </HStack>
              )}
            </Table.Cell>

            <Table.Cell whiteSpace="nowrap">
              <AgentValue
                value={agent.health === null ? null : AGENT_HEALTH_LABELS[agent.health]}
              />
            </Table.Cell>

            <Table.Cell whiteSpace="nowrap">
              <AgentValue
                value={formatAgentCost(agent)}
                missingReason={agentCostMissingReason(agent)}
              />
            </Table.Cell>

            <Table.Cell whiteSpace="nowrap">
              <AgentValue value={formatAgentRequests(agent)} />
            </Table.Cell>

            <Table.Cell whiteSpace="nowrap">
              <AgentValue value={formatAgentLastActive(agent)} missingReason={AGENT_NEVER_RUN} />
            </Table.Cell>

            <Table.Cell whiteSpace="nowrap">
              <AgentValue value={formatRegistered(agent.registeredDaysAgo)} />
            </Table.Cell>
          </Table.Row>
        ))}
      </Table.Body>
    </ListTable>
  );
}
