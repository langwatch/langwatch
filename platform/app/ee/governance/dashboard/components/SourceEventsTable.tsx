// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import {
  Badge,
  Box,
  Heading,
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

import { EventDetailRow } from "./SourceEventDetailPanels";
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
  const ms = Date.parse(iso);
  // An unparsable timestamp gets a plain dash — a tooltip would only
  // have "Invalid Date" to say.
  if (Number.isNaN(ms)) {
    return (
      <Text textStyle="sm" whiteSpace="nowrap">
        —
      </Text>
    );
  }
  return (
    <Tooltip content={new Date(ms).toLocaleString()}>
      <Text textStyle="sm" cursor="help" whiteSpace="nowrap">
        {formatTimeAgo(ms) ?? "—"}
      </Text>
    </Tooltip>
  );
}

function EventDataRow({
  event,
  isExpanded,
  onToggle,
}: {
  event: SourceEventRowData;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const hasTokens = event.tokensInput > 0 || event.tokensOutput > 0;
  return (
    <Table.Row
      data-testid="source-event-row"
      cursor="pointer"
      onClick={onToggle}
      // A <tr> is not focusable or activatable on its own; the row is a
      // disclosure control, so it gets the keyboard affordances too.
      tabIndex={0}
      aria-expanded={isExpanded}
      onKeyDown={(keyEvent) => {
        if (keyEvent.key !== "Enter" && keyEvent.key !== " ") return;
        keyEvent.preventDefault();
        onToggle();
      }}
      _hover={{ bg: "bg.subtle" }}
      _focusVisible={{ bg: "bg.subtle", outline: "none" }}
      bg={isExpanded ? "bg.subtle" : undefined}
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
            isExpanded={expandedEventId === event.eventId}
            onToggle={() =>
              setExpandedEventId((current) =>
                current === event.eventId ? null : event.eventId,
              )
            }
          />
          {expandedEventId === event.eventId && (
            <EventDetailRow event={event} colSpan={COLUMNS.length} />
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
          {/* A failure while pages are already on screen must not hide
              them — it names itself above the table and the next click
              retries the walk. */}
          {pager.error != null && (
            <Box marginBottom={2}>
              <HandledErrorAlert
                error={pager.error}
                fallbackTitle="Couldn't load more events"
              />
            </Box>
          )}
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
