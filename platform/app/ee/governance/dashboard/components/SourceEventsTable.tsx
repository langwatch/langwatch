// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import {
  Badge,
  Box,
  Code,
  Heading,
  SimpleGrid,
  Skeleton,
  Table,
  Text,
  VStack,
} from "@chakra-ui/react";
import numeral from "numeral";
import { Fragment, type ReactNode, useState } from "react";

import { ListTable } from "~/components/ui/ListTable";
import { Pagination } from "~/components/ui/Pagination";
import { Tooltip } from "~/components/ui/tooltip";
import { HandledErrorAlert } from "~/features/errors";
import { formatTimeAgo } from "~/utils/formatTimeAgo";

import type { SourceEventsPager } from "./useSourceEventsPager";

/**
 * The events section of the ingestion-source detail page: a cursor-walked
 * table over everything the source ever ingested, newest first.
 *
 * Deliberately absent, because the cursor cannot honour them: sort
 * headers, a search box, a grand total, and jumping to a page nobody
 * has walked to yet.
 *
 * Spec: specs/ai-gateway/governance/ingestion-sources.feature
 *       (rule "The events table pages through everything the source
 *       ever ingested")
 */

/** Structural shape of `eventsForSource`'s rows — no tRPC import, so the
 * table stays testable against plain fixtures. */
export type SourceEventRowData = {
  eventId: string;
  eventType: string;
  actor: string;
  action: string;
  target: string | null;
  costUsd: string;
  tokensInput: number;
  tokensOutput: number;
  eventTimestampIso: string;
  ingestedAtIso: string;
  rawPayload: string;
};

const fmtUsd = (raw: string) => {
  const value = Number(raw);
  return value === 0 ? "$0.00" : numeral(value).format("$0,0.0000");
};

const COLUMNS = [
  "Time",
  "Type",
  "Actor",
  "Action",
  "Target",
  "Cost",
  "Tokens",
] as const;

function EventsTableHeader() {
  return (
    <Table.Header>
      <Table.Row>
        {COLUMNS.map((column) => (
          <Table.ColumnHeader
            key={column}
            textAlign={
              column === "Cost" || column === "Tokens" ? "end" : undefined
            }
          >
            {column}
          </Table.ColumnHeader>
        ))}
      </Table.Row>
    </Table.Header>
  );
}

function EventTimeCell({ iso }: { iso: string }) {
  const ms = new Date(iso).getTime();
  return (
    <Tooltip content={new Date(iso).toLocaleString()}>
      <Text textStyle="sm" cursor="help" whiteSpace="nowrap">
        {formatTimeAgo(ms) ?? "—"}
      </Text>
    </Tooltip>
  );
}

function EventDataRow({
  event,
  expanded,
  onToggle,
}: {
  event: SourceEventRowData;
  expanded: boolean;
  onToggle: () => void;
}) {
  const hasTokens = event.tokensInput > 0 || event.tokensOutput > 0;
  return (
    <Table.Row
      data-testid="source-event-row"
      cursor="pointer"
      onClick={onToggle}
      _hover={{ bg: "bg.subtle" }}
      bg={expanded ? "bg.subtle" : undefined}
    >
      <Table.Cell whiteSpace="nowrap">
        <EventTimeCell iso={event.eventTimestampIso} />
      </Table.Cell>
      <Table.Cell>
        <Badge size="sm" variant="surface">
          {event.eventType}
        </Badge>
      </Table.Cell>
      <Table.Cell>
        <Text textStyle="sm" fontWeight="medium" lineClamp={1}>
          {event.actor || "—"}
        </Text>
      </Table.Cell>
      <Table.Cell>
        <Text textStyle="sm" color="fg.muted" lineClamp={1}>
          {event.action || "—"}
        </Text>
      </Table.Cell>
      <Table.Cell>
        <Text textStyle="sm" color="fg.muted" lineClamp={1}>
          {event.target || "—"}
        </Text>
      </Table.Cell>
      <Table.Cell textAlign="end" whiteSpace="nowrap">
        <Text textStyle="sm" color="fg.muted">
          {fmtUsd(event.costUsd)}
        </Text>
      </Table.Cell>
      <Table.Cell textAlign="end" whiteSpace="nowrap">
        <Text textStyle="sm" color="fg.muted">
          {hasTokens
            ? `${numeral(event.tokensInput).format("0,0")} → ${numeral(
                event.tokensOutput,
              ).format("0,0")}`
            : "—"}
        </Text>
      </Table.Cell>
    </Table.Row>
  );
}

function EventDetailRow({ event }: { event: SourceEventRowData }) {
  return (
    <Table.Row>
      <Table.Cell colSpan={COLUMNS.length} bg="bg.subtle">
        <SimpleGrid columns={{ base: 1, lg: 2 }} gap={3} paddingY={1}>
          <NormalisedPanel event={event} />
          <RawPanel event={event} />
        </SimpleGrid>
      </Table.Cell>
    </Table.Row>
  );
}

function NormalisedPanel({ event }: { event: SourceEventRowData }) {
  return (
    <Box>
      <Text
        fontSize="xs"
        fontWeight="semibold"
        color="fg.muted"
        marginBottom={1}
      >
        Normalised (OCSF)
      </Text>
      <Code
        display="block"
        padding={3}
        fontSize="xs"
        whiteSpace="pre-wrap"
        wordBreak="break-all"
        backgroundColor="bg.panel"
      >
        {JSON.stringify(
          {
            eventId: event.eventId,
            eventType: event.eventType,
            actor: event.actor,
            action: event.action,
            target: event.target,
            costUsd: event.costUsd,
            tokensInput: event.tokensInput,
            tokensOutput: event.tokensOutput,
            eventTimestamp: event.eventTimestampIso,
            ingestedAt: event.ingestedAtIso,
          },
          null,
          2,
        )}
      </Code>
    </Box>
  );
}

function RawPanel({ event }: { event: SourceEventRowData }) {
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(event.rawPayload);
  } catch {
    // not JSON, render as text
  }
  return (
    <Box>
      <Text
        fontSize="xs"
        fontWeight="semibold"
        color="fg.muted"
        marginBottom={1}
      >
        Raw payload (as ingested)
      </Text>
      {event.rawPayload ? (
        <Code
          display="block"
          padding={3}
          fontSize="xs"
          whiteSpace="pre-wrap"
          wordBreak="break-all"
          backgroundColor="bg.panel"
        >
          {parsed != null ? JSON.stringify(parsed, null, 2) : event.rawPayload}
        </Code>
      ) : (
        <Text fontSize="xs" color="fg.muted">
          The raw body is not stored for this source type — pushed events are
          normalised at the edge and only the normalised record is kept.
        </Text>
      )}
    </Box>
  );
}

function SkeletonRows({ pageSize }: { pageSize: number }) {
  const rowCount = Math.min(pageSize, 5);
  return (
    <>
      {Array.from({ length: rowCount }, (_, index) => (
        <Table.Row key={index} data-testid="source-event-skeleton-row">
          {COLUMNS.map((column) => (
            <Table.Cell key={column}>
              <Skeleton height="14px" maxWidth="120px" borderRadius="sm" />
            </Table.Cell>
          ))}
        </Table.Row>
      ))}
    </>
  );
}

function EventsTableBody({
  pager,
}: {
  pager: SourceEventsPager<SourceEventRowData>;
}) {
  const [expandedEventId, setExpandedEventId] = useState<string | null>(null);
  if (pager.status === "loading") {
    return <SkeletonRows pageSize={pager.pageSize} />;
  }
  return (
    <>
      {pager.rows.map((event) => (
        <Fragment key={event.eventId}>
          <EventDataRow
            event={event}
            expanded={expandedEventId === event.eventId}
            onToggle={() =>
              setExpandedEventId((current) =>
                current === event.eventId ? null : event.eventId,
              )
            }
          />
          {expandedEventId === event.eventId && (
            <EventDetailRow event={event} />
          )}
        </Fragment>
      ))}
    </>
  );
}

export function SourceEventsTable({
  pager,
  emptyState,
}: {
  pager: SourceEventsPager<SourceEventRowData>;
  emptyState: ReactNode;
}) {
  return (
    <VStack align="stretch" gap={3}>
      <VStack align="start" gap={1}>
        <Heading as="h3" size="sm">
          Events
        </Heading>
        {pager.status !== "error" && (
          <Text fontSize="sm" color="fg.muted">
            Every OCSF-normalised event from this source, newest first. Click a
            row for the raw and normalised records.
          </Text>
        )}
      </VStack>

      {pager.status === "error" ? (
        <HandledErrorAlert
          error={pager.error}
          fallbackTitle="Couldn't load this source's events"
        />
      ) : pager.status === "ready" && pager.loadedCount === 0 ? (
        emptyState
      ) : (
        <Box>
          <ListTable size="sm" containerProps={{ overflowX: "auto" }}>
            <EventsTableHeader />
            <Table.Body>
              <EventsTableBody pager={pager} />
            </Table.Body>
          </ListTable>
          <Pagination
            page={pager.page}
            pageSize={pager.pageSize}
            totalCount={pager.totalCount}
            visibleCount={pager.rows.length}
            onPageChange={pager.goToPage}
            onPageSizeChange={pager.setPageSize}
            isLoading={pager.status === "loading"}
            navDisabled={pager.isFetching}
            isPageReachable={pager.isPageReachable}
            canGoNext={pager.canGoNext}
          />
        </Box>
      )}
    </VStack>
  );
}
