import { Badge, HStack, Table, Text } from "@chakra-ui/react";

import { ListTable } from "~/components/ui/ListTable";

import {
  AGENT_NEVER_RUN,
  AgentValue,
  agentCostMissingReason,
  formatAgentCost,
  formatAgentLastActive,
  formatAgentRequests,
} from "./AgentFigure";
import {
  AGENT_HEALTH_LABELS,
  AGENT_SOURCE_LABELS,
  formatRegistered,
  type GovernanceAgentRow,
} from "./agentRows";

/**
 * The fleet as a list: one row per agent, one column per attribute the row
 * carries.
 *
 * THIS IS THE PAGE'S DEFAULT, and the cards are the option. An admin opens
 * this page to answer "what is running against this organization" — which is a
 * comparison across agents, not a reading of one — and the card grid spends a
 * whole panel on each agent, so ten of them is a scroll. The list puts them
 * one per line, which is what the question wanted.
 *
 * WHICH COLUMNS. All ten attributes `GovernanceAgentRow` carries, because they
 * are what an agent has and this is the layout with room to show them. Two of
 * them — health and how long ago the agent registered — appear nowhere else on
 * the page per agent: the card has no room for them and the summary strip only
 * counts them across the fleet. Surfacing those two is a large part of why the
 * list is worth having. That makes the table wider than most panes, so the
 * body scrolls sideways rather than the words shrinking.
 *
 * HEADERS ARE SPELLED OUT. "Cost · 30 days", not "Cost 30d"; "Requests · 30
 * days", not "Reqs". A shortened header saves a few pixels and costs the
 * reader a guess, and a wrong guess about a money column is expensive.
 *
 * HEALTH IS A WORD, NOT A DOT. The summary strip pairs each health state with
 * a coloured dot and says in its own source that the dot repeats what the
 * words already say. Here the words are all there is room for, and they were
 * carrying the meaning in both places anyway.
 *
 * Every figure goes through `AgentValue`, the same component the card uses, so
 * a column the agent has nothing for is an em dash carrying its reason rather
 * than a zero or a blank. That the two layouts share it is what stops them
 * disagreeing about a number.
 *
 * Spec: specs/ai-governance/dashboard/agents-page.feature
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
          <Table.Row
            key={agent.id}
            data-testid="governance-agent-row"
            data-agent={agent.name}
          >
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
              <Text textStyle="sm" color="fg.muted">
                {agent.environment}
              </Text>
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
                    <Badge
                      key={model}
                      size="xs"
                      variant="outline"
                      colorPalette="gray"
                    >
                      {model}
                    </Badge>
                  ))}
                </HStack>
              )}
            </Table.Cell>

            <Table.Cell whiteSpace="nowrap">
              <AgentValue
                value={
                  agent.health === null
                    ? null
                    : AGENT_HEALTH_LABELS[agent.health]
                }
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
              <AgentValue
                value={formatAgentLastActive(agent)}
                missingReason={AGENT_NEVER_RUN}
              />
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
