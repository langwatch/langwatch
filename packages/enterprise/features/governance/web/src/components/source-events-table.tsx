// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import {
  Alert,
  Badge,
  Box,
  Button,
  Heading,
  HStack,
  NativeSelect,
  Skeleton,
  Table,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { Fragment, type ReactNode, useState } from "react";
import { EventDetailRow } from "./source-event-detail-panels";
import type { SourceEventsPager } from "../hooks/use-source-events-pager";

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
  renderTable?: (input: { header: ReactNode; body: ReactNode }) => ReactNode;
  renderPagination?: (
    pager: SourceEventsPager<SourceEventRowData>,
  ) => ReactNode;
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
  const seconds = Math.max(0, Math.floor((Date.now() - timestampMs) / 1000));
  if (seconds < 60) return `${seconds} seconds ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hours ago`;
  return `${Math.floor(hours / 24)} days ago`;
};

function ErrorAlert({ title }: { title: string }) {
  return (
    <Alert.Root status="error">
      <Alert.Indicator />
      <Alert.Title>{title}</Alert.Title>
    </Alert.Root>
  );
}

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
            ? `${fmtInteger(event.tokensInput)} → ${fmtInteger(event.tokensOutput)}`
            : "—"}
        </Text>
      </Table.Cell>
    </Table.Row>
  );
}

function SourceEventsPagination({
  pager,
}: {
  pager: SourceEventsPager<SourceEventRowData>;
}) {
  const pageCount = Math.max(1, Math.ceil(pager.totalCount / pager.pageSize));
  const start = (pager.page - 1) * pager.pageSize + 1;
  const end = start + Math.max(0, pager.rows.length - 1);
  return (
    <HStack data-testid="pagination" justify="space-between" marginTop={3}>
      <Text data-testid="pagination-indicator" fontSize="sm" color="fg.muted">
        showing {start}–{end}
      </Text>
      <HStack>
        <NativeSelect.Root size="sm" width="90px">
          <NativeSelect.Field
            aria-label="Rows per page"
            data-testid="pagination-page-size"
            value={pager.pageSize}
            onChange={(event) => pager.setPageSize(Number(event.target.value))}
          >
            {[10, 25, 50, 100].map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </NativeSelect.Field>
          <NativeSelect.Indicator />
        </NativeSelect.Root>
        <Button
          data-testid="pagination-prev"
          size="sm"
          variant="outline"
          disabled={pager.page <= 1 || pager.isFetching}
          onClick={() => pager.goToPage(pager.page - 1)}
        >
          Previous
        </Button>
        {Array.from({ length: pageCount }, (_, index) => index + 1).map(
          (page) => (
            <Button
              key={page}
              data-testid={`pagination-page-${page}`}
              size="sm"
              variant={pager.page === page ? "solid" : "ghost"}
              disabled={!pager.isPageReachable(page) || pager.isFetching}
              onClick={() => pager.goToPage(page)}
            >
              {page}
            </Button>
          ),
        )}
        <Button
          data-testid="pagination-next"
          size="sm"
          variant="outline"
          disabled={!pager.canGoNext || pager.isFetching}
          onClick={() => pager.goToPage(pager.page + 1)}
        >
          Next
        </Button>
      </HStack>
    </HStack>
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
  presentation,
}: {
  pager: SourceEventsPager<SourceEventRowData>;
  emptyState: ReactNode;
  presentation?: SourceEventsTablePresentation;
}) {
  const renderError = (error: unknown, title: string) =>
    presentation?.renderError?.({ error, title }) ?? (
      <ErrorAlert title={title} />
    );
  const tableHeader = <EventsTableHeader />;
  const tableBody = (
    <Table.Body>
      <EventsTableBody pager={pager} />
    </Table.Body>
  );
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
        renderError(pager.error, "Couldn't load this source's events")
      ) : pager.status === "ready" && pager.loadedCount === 0 ? (
        emptyState
      ) : (
        <Box>
          {/* A failure while pages are already on screen must not hide
              them — it names itself above the table and the next click
              retries the walk. */}
          {pager.error != null && (
            <Box marginBottom={2}>
              {renderError(pager.error, "Couldn't load more events")}
            </Box>
          )}
          {presentation?.renderTable?.({
            header: tableHeader,
            body: tableBody,
          }) ?? (
            <Box overflowX="auto">
              <Table.Root size="sm">
                {tableHeader}
                {tableBody}
              </Table.Root>
            </Box>
          )}
          {presentation?.renderPagination?.(pager) ?? (
            <SourceEventsPagination pager={pager} />
          )}
        </Box>
      )}
    </VStack>
  );
}
