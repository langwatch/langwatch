import { formatCost, formatTokens } from "@langwatch/design-system/display-formatters";
import { FormattedDate } from "@langwatch/design-system/formatted-date";
import { FormattedNumber } from "@langwatch/design-system/formatted-number";
import { ListTable } from "@langwatch/design-system/list-table";
import { type EmptyNext, NoDataInfoBlock } from "@langwatch/design-system/no-data-info-block";
import { HStack, Spinner, Text } from "@langwatch/design-system/primitives";
import { readableDate } from "@langwatch/time";
import type React from "react";

import { useTerminalReplay } from "../../behavior/use-terminal-replay.ts";
import { type DetailPayload } from "../../model/pull-request-detail.ts";
import { formatShortDate } from "../../model/short-date.ts";
import { AgentLabel } from "../elements/agent-label.tsx";
import { MISSING_VALUE } from "../elements/cells/missing-value.tsx";
import { ContributorName } from "../elements/contributor-name.tsx";
import { Section } from "../elements/detail-section.tsx";

/** One session as the pull request detail lists it. */
type DetailSession = DetailPayload["sessions"][number];

const SESSIONS_NEXT: EmptyNext = [
  {
    kind: "docs",
    label: "How sessions are linked to pull requests",
    href: "https://docs.langwatch.ai/coding-agents/repository-and-pr-attribution",
  },
];

/** Sessions on PR (title, start, contributor, agent, tokens, cost); row replays terminal. */
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
        <NoDataInfoBlock
          size="line"
          title="No sessions ran on this pull request yet"
          next={SESSIONS_NEXT}
        />
      ) : (
        <ListTable size="sm" containerProps={{ overflowX: "auto" }}>
          <ListTable.Header>
            <ListTable.Row>
              <ListTable.ColumnHeader>Session</ListTable.ColumnHeader>
              <ListTable.ColumnHeader>Started</ListTable.ColumnHeader>
              <ListTable.ColumnHeader>Contributor</ListTable.ColumnHeader>
              <ListTable.ColumnHeader>Agent</ListTable.ColumnHeader>
              <ListTable.ColumnHeader align="end">Tokens</ListTable.ColumnHeader>
              <ListTable.ColumnHeader align="end">Token cost</ListTable.ColumnHeader>
            </ListTable.Row>
          </ListTable.Header>
          <ListTable.Body>
            {sessions.map((session) => (
              <SessionRow
                key={session.sessionId}
                session={session}
                isOpening={replay.openingSessionId === session.sessionId}
                // A row with no session named on it, and a drawer with no
                // project to read one in, have nothing to open: they stay
                // plain rows rather than controls that do nothing.
                onOpenReplay={
                  session.sessionId && projectId ? () => void replay.openReplay(session) : undefined
                }
                onPrefetch={
                  session.sessionId && projectId ? () => replay.prefetch(session) : undefined
                }
              />
            ))}
          </ListTable.Body>
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
  <ListTable.Row onActivate={onOpenReplay} onPrefetch={onPrefetch} aria-busy={isOpening}>
    <ListTable.Cell>
      <HStack gap={2} minWidth={0}>
        {/* The whole row opens the replay for a pointer; the name carries the
            same action as a real button for a keyboard. A row with nothing to
            open renders the name and no control at all. */}
        {onOpenReplay ? (
          <ListTable.RowAction
            label={`Open the terminal replay of ${session.title ?? "untitled session"}`}
            onActivate={onOpenReplay}
          >
            {session.title ?? (
              <Text as="span" color="fg.muted">
                Untitled session
              </Text>
            )}
          </ListTable.RowAction>
        ) : (
          (session.title ?? (
            <Text as="span" color="fg.muted">
              Untitled session
            </Text>
          ))
        )}
        {isOpening ? <Spinner size="xs" color="fg.muted" flexShrink={0} /> : null}
      </HStack>
    </ListTable.Cell>
    <ListTable.Cell nowrap>
      <FormattedDate value={session.startedAtMs}>
        {formatShortDate({ timestampMs: session.startedAtMs })}{" "}
        {readableDate(session.startedAtMs).toLocaleTimeString(undefined, {
          hour: "2-digit",
          minute: "2-digit",
        })}
      </FormattedDate>
    </ListTable.Cell>
    <ContributorName contributor={session} />
    <ListTable.Cell tone="muted">
      {session.agent ? <AgentLabel agent={session.agent} /> : MISSING_VALUE}
    </ListTable.Cell>
    <ListTable.Cell align="end">
      <FormattedNumber value={session.totalTokens} unit="tokens">
        {formatTokens(session.totalTokens)}
      </FormattedNumber>
    </ListTable.Cell>
    <ListTable.Cell align="end">
      {session.costUsd === null ? (
        MISSING_VALUE
      ) : (
        <FormattedNumber value={session.costUsd} currency="USD">
          {formatCost(session.costUsd)}
        </FormattedNumber>
      )}
    </ListTable.Cell>
  </ListTable.Row>
);
