import { HStack, Spinner, Table, Text } from "@chakra-ui/react";
import type React from "react";

import { ListTable } from "~/components/ui/ListTable";
import {
  formatCost,
  formatTokens,
} from "~/features/traces-v2/utils/formatters";

import { AgentLabel } from "../AgentLabel";
import { useTerminalReplay } from "../sessions/useTerminalReplay";
import { formatShortDate } from "../shortDate";
import { ContributorName } from "./ContributorName";
import { type DetailPayload, MISSING_VALUE } from "./detailPayload";
import { EmptySection, Section } from "./Section";

/** One session as the pull request detail lists it. */
type DetailSession = DetailPayload["sessions"][number];

/**
 * The sessions that ran on the pull request: the title the agent generated for
 * each one, then its start time, contributor, agent, tokens and cost.
 *
 * The title is the only conversation-derived value here, and the read decides
 * whether this reader gets it, per the project each session ran in. A session
 * with none, and a session whose title this reader may not see, both read as
 * untitled: the row is still worth listing for what it consumed.
 *
 * Choosing a row replays that session in the terminal, the same way the
 * Sessions table does and through the same hook. The replay opens over this
 * drawer rather than replacing it, so closing it comes back to the pull
 * request the reader was reading.
 */
export const SessionsSection: React.FC<{
  projectId: string;
  sessions: DetailPayload["sessions"];
}> = ({ projectId, sessions }) => {
  // These rows are read from the caller's personal workspace while the app
  // chrome sits in whichever project they last visited, so the project travels
  // with the trace rather than being resolved by the drawer.
  const replay = useTerminalReplay({ projectId, projectSlug: null });

  return (
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
              <Table.ColumnHeader textAlign="end">
                Token cost
              </Table.ColumnHeader>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {sessions.map((session) => (
              <SessionRow
                key={session.sessionId}
                session={session}
                isOpening={replay.openingSessionId === session.sessionId}
                // A row with no session named on it, and a drawer with no
                // project to read one in, have nothing to open: they stay
                // plain rows rather than controls that do nothing.
                onOpenReplay={
                  session.sessionId && projectId
                    ? () => void replay.openReplay(session)
                    : undefined
                }
                onPrefetch={
                  session.sessionId && projectId
                    ? () => replay.prefetch(session)
                    : undefined
                }
              />
            ))}
          </Table.Body>
        </ListTable>
      )}
    </Section>
  );
};

const SessionRow: React.FC<{
  session: DetailSession;
  isOpening: boolean;
  onOpenReplay: (() => void) | undefined;
  onPrefetch: (() => void) | undefined;
}> = ({ session, isOpening, onOpenReplay, onPrefetch }) => (
  <Table.Row
    onClick={onOpenReplay}
    onMouseEnter={onPrefetch}
    aria-busy={isOpening}
    cursor={onOpenReplay ? "pointer" : undefined}
    _hover={onOpenReplay ? { bg: "bg.subtle" } : undefined}
  >
    <Table.Cell fontSize="sm">
      <HStack gap={2} minWidth={0}>
        {session.title ?? (
          <Text as="span" color="fg.muted">
            Untitled session
          </Text>
        )}
        {isOpening ? (
          <Spinner size="xs" color="fg.muted" flexShrink={0} />
        ) : null}
      </HStack>
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
      {session.agent ? <AgentLabel agent={session.agent} /> : MISSING_VALUE}
    </Table.Cell>
    <Table.Cell textAlign="end" fontSize="sm">
      {formatTokens(session.totalTokens)}
    </Table.Cell>
    <Table.Cell textAlign="end" fontSize="sm">
      {session.costUsd === null ? MISSING_VALUE : formatCost(session.costUsd)}
    </Table.Cell>
  </Table.Row>
);
