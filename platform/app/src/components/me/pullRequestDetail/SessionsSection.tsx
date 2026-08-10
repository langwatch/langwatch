import { Table, Text } from "@chakra-ui/react";
import type React from "react";

import { ListTable } from "~/components/ui/ListTable";
import {
  formatCost,
  formatTokens,
} from "~/features/traces-v2/utils/formatters";

import { AgentLabel } from "../AgentLabel";
import { formatShortDate } from "../shortDate";
import { ContributorName } from "./ContributorName";
import { type DetailPayload, MISSING_VALUE } from "./detailPayload";
import { EmptySection, Section } from "./Section";

/**
 * The sessions that ran on the pull request: the title the agent generated for
 * each one, then its start time, contributor, agent, tokens and cost.
 *
 * The title is the only conversation-derived value here, and the read decides
 * whether this reader gets it, per the project each session ran in. A session
 * with none, and a session whose title this reader may not see, both read as
 * untitled: the row is still worth listing for what it consumed.
 */
export const SessionsSection: React.FC<{
  sessions: DetailPayload["sessions"];
}> = ({ sessions }) => (
  <Section title="Sessions">
    {sessions.length === 0 ? (
      <EmptySection>No sessions ran on this pull request yet</EmptySection>
    ) : (
      <ListTable size="sm" containerProps={{ overflowX: "auto" }}>
        <Table.Header>
          <Table.Row>
            <Table.ColumnHeader>Session</Table.ColumnHeader>
            <Table.ColumnHeader>Started</Table.ColumnHeader>
            <Table.ColumnHeader>Contributor</Table.ColumnHeader>
            <Table.ColumnHeader>Agent</Table.ColumnHeader>
            <Table.ColumnHeader textAlign="end">Tokens</Table.ColumnHeader>
            <Table.ColumnHeader textAlign="end">Token cost</Table.ColumnHeader>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {sessions.map((session) => (
            <Table.Row key={session.sessionId}>
              <Table.Cell fontSize="sm">
                {session.title ?? (
                  <Text as="span" color="fg.muted">
                    Untitled session
                  </Text>
                )}
              </Table.Cell>
              <Table.Cell fontSize="sm" whiteSpace="nowrap">
                {formatShortDate({ timestampMs: session.startedAtMs })}{" "}
                {new Date(session.startedAtMs).toLocaleTimeString(undefined, {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </Table.Cell>
              <ContributorName contributor={session} />
              <Table.Cell fontSize="sm" color="fg.muted">
                {session.agent ? (
                  <AgentLabel agent={session.agent} />
                ) : (
                  MISSING_VALUE
                )}
              </Table.Cell>
              <Table.Cell textAlign="end" fontSize="sm">
                {formatTokens(session.totalTokens)}
              </Table.Cell>
              <Table.Cell textAlign="end" fontSize="sm">
                {session.costUsd === null
                  ? MISSING_VALUE
                  : formatCost(session.costUsd)}
              </Table.Cell>
            </Table.Row>
          ))}
        </Table.Body>
      </ListTable>
    )}
  </Section>
);
