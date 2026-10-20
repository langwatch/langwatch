import { ListTable } from "@langwatch/design-system/list-table";
import { Badge, HStack, Text } from "@langwatch/design-system/primitives";
import { type GovernanceAgentRow } from "@langwatch/enterprise-governance-contract";

import {
  AGENT_NEVER_RUN,
  AgentEnvironment,
  AgentValue,
  agentCostMissingReason,
  formatAgentCost,
  formatAgentLastActive,
  formatAgentRequests,
} from "./agent-figure";
import { AGENT_HEALTH_LABELS, AGENT_SOURCE_LABELS, formatRegistered } from "./agent-rows";

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
      <ListTable.Header>
        <ListTable.Row>
          <ListTable.ColumnHeader>Agent</ListTable.ColumnHeader>
          {AGENT_TABLE_COLUMNS.map((column) => (
            <ListTable.ColumnHeader key={column}>{column}</ListTable.ColumnHeader>
          ))}
        </ListTable.Row>
      </ListTable.Header>
      <ListTable.Body>
        {agents.map((agent) => (
          <ListTable.Row key={agent.id} data-testid="governance-agent-row" data-agent={agent.name}>
            <ListTable.Cell nowrap>
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
            </ListTable.Cell>

            <ListTable.Cell nowrap>
              <AgentEnvironment environment={agent.environment} />
            </ListTable.Cell>

            <ListTable.Cell nowrap>
              {/* Unclaimed is a fact about the agent, not a figure nobody
                  measured, so it is the badge the card uses and never a
                  "No data". */}
              {agent.owner === null ? (
                <Badge size="xs" variant="subtle" colorPalette="orange">
                  Unclaimed
                </Badge>
              ) : (
                <Text textStyle="sm" color="fg.muted">
                  {agent.owner}
                </Text>
              )}
            </ListTable.Cell>

            <ListTable.Cell nowrap>
              <Badge size="xs" variant="subtle" colorPalette="purple">
                {AGENT_SOURCE_LABELS[agent.source]}
              </Badge>
            </ListTable.Cell>

            <ListTable.Cell>
              {agent.models.length === 0 ? (
                <AgentValue label="Models" value={null} />
              ) : (
                <HStack gap={1} wrap="wrap">
                  {agent.models.map((model) => (
                    <Badge key={model} size="xs" variant="outline" colorPalette="gray">
                      {model}
                    </Badge>
                  ))}
                </HStack>
              )}
            </ListTable.Cell>

            <ListTable.Cell nowrap>
              <AgentValue
                label="Health"
                value={agent.health === null ? null : AGENT_HEALTH_LABELS[agent.health]}
              />
            </ListTable.Cell>

            <ListTable.Cell nowrap>
              <AgentValue
                label="Cost · 30 days"
                value={formatAgentCost(agent)}
                missingReason={agentCostMissingReason(agent)}
              />
            </ListTable.Cell>

            <ListTable.Cell nowrap>
              <AgentValue label="Requests · 30 days" value={formatAgentRequests(agent)} />
            </ListTable.Cell>

            <ListTable.Cell nowrap>
              <AgentValue
                label="Last active"
                value={formatAgentLastActive(agent)}
                missingReason={AGENT_NEVER_RUN}
              />
            </ListTable.Cell>

            <ListTable.Cell nowrap>
              <AgentValue label="Registered" value={formatRegistered(agent.registeredDaysAgo)} />
            </ListTable.Cell>
          </ListTable.Row>
        ))}
      </ListTable.Body>
    </ListTable>
  );
}
