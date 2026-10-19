// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { Banner } from "@langwatch/design-system/banner";
import { ListTable } from "@langwatch/design-system/list-table";
import { Pagination } from "@langwatch/design-system/pagination";
import { Badge, Box, Heading, HStack, Text, VStack } from "@langwatch/design-system/primitives";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { nowInstant, toEpochMs, readableDate } from "@langwatch/time";
import { Fragment, type ReactNode, useState } from "react";

import type { SourceEventsPager } from "../../behavior/use-source-events-pager.ts";
import { detailRowId, EventDetailRow } from "./source-event-detail-panels.tsx";

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

export type SourceEventsTablePresentation = {
  renderError?: (input: { error: unknown; title: string }) => ReactNode;
};

const fmtUsd = (raw: string) => {
  const value = Number(raw);
  return value === 0
    ? "$0.00"
    : new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 4,
        maximumFractionDigits: 4,
      }).format(value);
};

const fmtInteger = (value: number): string =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);

const formatTimeAgo = (timestampMs: number): string => {
  const seconds = Math.max(0, Math.floor((nowInstant().epochMilliseconds - timestampMs) / 1000));
  if (seconds < 60) return `${seconds} seconds ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hours ago`;
  return `${Math.floor(hours / 24)} days ago`;
};

function ErrorAlert({ title }: { title: string }) {
  return <Banner status="error">{title}</Banner>;
}

const COLUMNS = ["Time", "Type", "Actor", "Action", "Target", "Cost", "Tokens"] as const;

function EventsTableHeader() {
  return (
    <ListTable.Header>
      <ListTable.Row>
        <ListTable.ColumnHeader width={40} label="Details" />
        {COLUMNS.map((column) => (
          <ListTable.ColumnHeader
            key={column}
            align={column === "Cost" || column === "Tokens" ? "end" : undefined}
          >
            {column}
          </ListTable.ColumnHeader>
        ))}
      </ListTable.Row>
    </ListTable.Header>
  );
}

function EventTimeCell({ iso }: { iso: string }) {
  const ms = toEpochMs(iso);
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
    <Tooltip content={readableDate(ms).toLocaleString()}>
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
    <ListTable.Row data-testid="source-event-row" expanded={isExpanded} onActivate={onToggle}>
      <ListTable.ExpandCell
        expanded={isExpanded}
        onToggle={onToggle}
        label={`Show details for event ${event.eventId}`}
        panelId={detailRowId(event.eventId)}
      />
      <ListTable.Cell nowrap>
        <EventTimeCell iso={event.eventTimestampIso} />
      </ListTable.Cell>
      <ListTable.Cell>
        <Badge size="sm" variant="surface">
          {event.eventType}
        </Badge>
      </ListTable.Cell>
      <ListTable.Cell>
        <Text textStyle="sm" fontWeight="medium" lineClamp={1}>
          {event.actor || "—"}
        </Text>
      </ListTable.Cell>
      <ListTable.Cell>
        <Text textStyle="sm" color="fg.muted" lineClamp={1}>
          {event.action || "—"}
        </Text>
      </ListTable.Cell>
      <ListTable.Cell>
        <Text textStyle="sm" color="fg.muted" lineClamp={1}>
          {event.target || "—"}
        </Text>
      </ListTable.Cell>
      <ListTable.Cell align="end" nowrap>
        <Text textStyle="sm" color="fg.muted">
          {fmtUsd(event.costUsd)}
        </Text>
      </ListTable.Cell>
      <ListTable.Cell align="end" nowrap>
        <Text textStyle="sm" color="fg.muted">
          {hasTokens ? `${fmtInteger(event.tokensInput)} → ${fmtInteger(event.tokensOutput)}` : "—"}
        </Text>
      </ListTable.Cell>
    </ListTable.Row>
  );
}

function SkeletonRows({ pageSize }: { pageSize: number }) {
  return <ListTable.LoadingRows rows={Math.min(pageSize, 5)} columns={COLUMNS.length + 1} />;
}

function EventsTableBody({ pager }: { pager: SourceEventsPager<SourceEventRowData> }) {
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
              setExpandedEventId((current) => (current === event.eventId ? null : event.eventId))
            }
          />
          {expandedEventId === event.eventId && (
            <EventDetailRow event={event} columns={COLUMNS.length + 1} />
          )}
        </Fragment>
      ))}
    </>
  );
}

export function SourceEventsTable({
  pager,
  emptyState,
  presentation,
  headerAside,
}: {
  pager: SourceEventsPager<SourceEventRowData>;
  emptyState: ReactNode;
  presentation?: SourceEventsTablePresentation;
  /**
   * Something to hang beside the heading — in practice the (i) that carries
   * this source's setup instructions. It sits here rather than inside the
   * empty state because those instructions are worth reading whether or not
   * events have arrived, and an admin debugging a source that IS delivering
   * would otherwise have no way to reach them.
   *
   * The table takes it as a node because the instructions are per-source and
   * this component deliberately knows nothing about sources.
   */
  headerAside?: ReactNode;
}) {
  const renderError = (error: unknown, title: string) =>
    presentation?.renderError?.({ error, title }) ?? <ErrorAlert title={title} />;
  const tableHeader = <EventsTableHeader />;
  const tableBody = (
    <ListTable.Body>
      <EventsTableBody pager={pager} />
    </ListTable.Body>
  );
  // "Click a row for the raw and normalised records" describes rows that are
  // not there in the empty state, and the empty pane says its own piece.
  const isEmpty = pager.status === "ready" && pager.loadedCount === 0;
  const isError = pager.status === "error";
  const showEmptyState = !isError && isEmpty;
  const showTable = !isError && !isEmpty;
  return (
    <VStack align="stretch" gap={3}>
      <VStack align="start" gap={1}>
        <HStack gap={1}>
          <Heading as="h3" textStyle="cardTitle">
            Events
          </Heading>
          {headerAside}
        </HStack>
        {pager.status !== "error" && !isEmpty && (
          <Text fontSize="sm" color="fg.muted">
            Every OCSF-normalised event from this source, newest first. Click a row for the raw and
            normalised records.
          </Text>
        )}
      </VStack>

      {isError && renderError(pager.error, "Couldn't load this source's events")}
      {showEmptyState && emptyState}
      {showTable && (
        <Box>
          {/* A failure while pages are already on screen must not hide
              them — it names itself above the table and the next click
              retries the walk. */}
          {pager.error != null && (
            <Box marginBottom={2}>{renderError(pager.error, "Couldn't load more events")}</Box>
          )}
          <ListTable density="compact" scroll="x" scrollLabel="Source events">
            {tableHeader}
            {tableBody}
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
