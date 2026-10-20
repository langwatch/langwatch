import { Drawer } from "@langwatch/design-system/drawer";
import { ListTable } from "@langwatch/design-system/list-table";
import { LoadMore } from "@langwatch/design-system/load-more";
import { Badge, HStack, Text, VStack } from "@langwatch/design-system/primitives";
import { SkeletonRows } from "@langwatch/design-system/skeletons";
import { type TimeInput, readableDate } from "@langwatch/time";
import { useEffect, useMemo, useState } from "react";

import {
  api,
  type RouterOutputs,
  type WebhookDeliveryCursor,
} from "../../../../behavior/gateway-api.ts";
import { keepPreviousData } from "../../../../model/keep-previous-data.ts";

const DELIVERIES_PAGE_SIZE = 25;

type EndpointView = RouterOutputs["webhookEndpoints"]["list"][number];
type HealthView = RouterOutputs["webhookEndpoints"]["health"];
type DeliveriesPage = RouterOutputs["webhookEndpoints"]["deliveries"];
type DeliveryView = DeliveriesPage["deliveries"][number];

function outcomePalette(outcome: string) {
  if (outcome === "success") return "green";
  if (outcome === "terminal") return "red";
  return "orange";
}

function outcomeBadge(outcome: string) {
  const palette = outcomePalette(outcome);
  return (
    <Badge size="sm" colorPalette={palette}>
      {outcome}
    </Badge>
  );
}

function formatWhen(at: TimeInput) {
  return readableDate(at).toLocaleString();
}

function formatAge(ms: number) {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  return `${(ms / 3_600_000).toFixed(1)}h`;
}

/** The health strip's numbers, all "..." until the health query lands. */
function healthLabels(health: HealthView | undefined) {
  if (!health) {
    return {
      lag: "...",
      sendsPerMinute: "...",
      successRate: "...",
      p95Latency: "...",
    };
  }
  return {
    lag:
      health.oldestUndeliveredAgeMs === null
        ? "caught up"
        : formatAge(health.oldestUndeliveredAgeMs),
    sendsPerMinute: health.sendsPerMinute.toFixed(2),
    successRate: health.successRate === null ? "n/a" : `${Math.round(health.successRate * 100)}%`,
    p95Latency: health.p95LatencyMs === null ? "n/a" : `${health.p95LatencyMs}ms`,
  };
}

/** One labelled number of the health strip. */
function HealthStat({ label, value }: { label: string; value: string }) {
  return (
    <HStack gap={1}>
      <Text color="fg.muted">{label}:</Text>
      <Text>{value}</Text>
    </HStack>
  );
}

/**
 * The endpoint's live health above the log: queue lag, dead-letter depth,
 * throughput, and the success and latency summary the health query polls.
 */
function WebhookHealthStrip({
  endpoint,
  health,
}: {
  endpoint: EndpointView;
  health: HealthView | undefined;
}) {
  const labels = healthLabels(health);
  const dlqDepth = health?.dlqDepth ?? 0;
  const lagging = (health?.oldestUndeliveredAgeMs ?? 0) > 300_000;

  return (
    <VStack align="start" gap={1} width="full" data-testid="webhook-health-strip">
      <Text fontSize="sm" color="fg.muted" wordBreak="break-all">
        {endpoint.url}
      </Text>
      <HStack gap={4} fontSize="sm" flexWrap="wrap">
        <HStack gap={1} data-testid="webhook-health-lag">
          <Text color="fg.muted">Lag:</Text>
          <Text fontWeight="600" color={lagging ? "fg.error" : undefined}>
            {labels.lag}
          </Text>
        </HStack>
        {dlqDepth > 0 && (
          <Badge colorPalette="red" data-testid="webhook-dlq-badge">
            {dlqDepth} dead-lettered
          </Badge>
        )}
        <HealthStat label="Sends/min" value={labels.sendsPerMinute} />
        <HealthStat label="Success" value={labels.successRate} />
        <HealthStat label="p95" value={labels.p95Latency} />
        <HealthStat
          label="Last success"
          value={endpoint.lastSuccessAt ? formatWhen(endpoint.lastSuccessAt) : "never"}
        />
        <HealthStat
          label="Failing since"
          value={endpoint.failingSince ? formatWhen(endpoint.failingSince) : "not failing"}
        />
        {endpoint.status === "DISABLED" && (
          <Badge colorPalette="red" data-testid="webhook-disabled-badge">
            disabled
            {endpoint.disabledReason === "auto_failures_72h" ? ": 72h of failures" : ""}
          </Badge>
        )}
      </HStack>
    </VStack>
  );
}

/** One attempt as the receiver answered it. */
function DeliveryRow({ delivery }: { delivery: DeliveryView }) {
  return (
    <ListTable.Row>
      <ListTable.Cell nowrap>{formatWhen(delivery.firedAt)}</ListTable.Cell>
      <ListTable.Cell>{delivery.attempt}</ListTable.Cell>
      <ListTable.Cell>{delivery.eventCount}</ListTable.Cell>
      <ListTable.Cell>{outcomeBadge(delivery.outcome)}</ListTable.Cell>
      <ListTable.Cell>{delivery.responseStatus ?? ""}</ListTable.Cell>
      <ListTable.Cell>
        {delivery.latencyMs !== null ? `${delivery.latencyMs}ms` : ""}
      </ListTable.Cell>
      <ListTable.Cell maxWidth="240px" truncate title={delivery.error ?? undefined}>
        {delivery.error ?? ""}
      </ListTable.Cell>
    </ListTable.Row>
  );
}

/** The attempt log for the loaded pages, with Load more while a cursor is left. */
function DeliveriesTable({
  rows,
  hasMore,
  isFetching,
  onLoadMore,
}: {
  rows: DeliveryView[];
  hasMore: boolean;
  isFetching: boolean;
  onLoadMore: () => void;
}) {
  return (
    <VStack align="stretch" gap={2} width="full">
      <ListTable variant="embedded" scroll="x" scrollLabel="Deliveries table">
        <ListTable.Header>
          <ListTable.Row>
            <ListTable.ColumnHeader>Fired</ListTable.ColumnHeader>
            <ListTable.ColumnHeader>Attempt</ListTable.ColumnHeader>
            <ListTable.ColumnHeader>Events</ListTable.ColumnHeader>
            <ListTable.ColumnHeader>Outcome</ListTable.ColumnHeader>
            <ListTable.ColumnHeader>Status</ListTable.ColumnHeader>
            <ListTable.ColumnHeader>Latency</ListTable.ColumnHeader>
            <ListTable.ColumnHeader>Error</ListTable.ColumnHeader>
          </ListTable.Row>
        </ListTable.Header>
        <ListTable.Body>
          {rows.map((d) => (
            <DeliveryRow key={d.id} delivery={d} />
          ))}
        </ListTable.Body>
      </ListTable>
      <LoadMore
        hasMore={hasMore}
        loading={isFetching}
        onLoadMore={onLoadMore}
        data-testid="webhook-deliveries-load-more"
      />
    </VStack>
  );
}

/**
 * The drawer's data: the delivery page for the current keyset cursor plus the
 * polled health summary. A fresh endpoint resets pagination to the first page.
 */
function useDeliveriesDrawerData(organizationId: string, endpoint: EndpointView | null) {
  const [cursor, setCursor] = useState<WebhookDeliveryCursor | undefined>(undefined);
  // Loaded pages accumulate in load order, keyed by the cursor that fetched
  // each, so Load more APPENDS below what the reader already scanned and a
  // background refetch of the current page replaces its own slot instead of
  // duplicating it. A fresh endpoint starts the accumulation over.
  const [pages, setPages] = useState<{ key: string; rows: DeliveryView[] }[]>([]);
  useEffect(() => {
    setCursor(undefined);
    setPages([]);
  }, [endpoint?.id]);
  const deliveries = api.webhookEndpoints.deliveries.useQuery(
    {
      organizationId,
      endpointId: endpoint?.id ?? "",
      limit: DELIVERIES_PAGE_SIZE,
      cursor,
    },
    { enabled: endpoint !== null, placeholderData: keepPreviousData },
  );
  const page = deliveries.data;
  useEffect(() => {
    if (!page) return;
    const key = cursor ? `${readableDate(cursor.firedAt).toISOString()}:${cursor.id}` : "first";
    setPages((prev) => {
      if (key === "first") return [{ key, rows: page.deliveries }];
      const at = prev.findIndex((p) => p.key === key);
      if (at >= 0) {
        const next = [...prev];
        next[at] = { key, rows: page.deliveries };
        return next;
      }
      return [...prev, { key, rows: page.deliveries }];
    });
  }, [page, cursor]);
  const rows = useMemo(
    () => (pages.length > 0 ? pages.flatMap((p) => p.rows) : (page?.deliveries ?? [])),
    [pages, page],
  );
  const health = api.webhookEndpoints.health.useQuery(
    {
      organizationId,
      endpointId: endpoint?.id ?? "",
    },
    { enabled: endpoint !== null },
  );

  return {
    deliveries,
    health,
    rows,
    hasMore: page?.nextCursor != null,
    isFirstPage: cursor === undefined,
    loadMore: () => setCursor(deliveries.data?.nextCursor ?? undefined),
  };
}

/**
 * Read-only delivery history for one endpoint: the health strip on top,
 * then one row per attempt (status code, latency, error excerpt) — the
 * WebhookEndpointDelivery log the delivery process manager records.
 */
export function WebhookDeliveriesDrawer({
  organizationId,
  endpoint,
  onClose,
}: {
  organizationId: string;
  /** Open while non-null. */
  endpoint: EndpointView | null;
  onClose: () => void;
}) {
  const { deliveries, health, rows, hasMore, isFirstPage, loadMore } = useDeliveriesDrawerData(
    organizationId,
    endpoint,
  );

  return (
    <Drawer open={endpoint !== null} onClose={onClose} size="lg" title="Deliveries">
      <VStack align="start" gap={4} width="full">
        {endpoint && <WebhookHealthStrip endpoint={endpoint} health={health.data} />}

        {deliveries.isLoading && <SkeletonRows rows={4} />}
        {deliveries.data && rows.length === 0 && isFirstPage && (
          <Text fontSize="sm" color="fg.muted">
            No deliveries recorded in the last 30 days.
          </Text>
        )}
        {rows.length > 0 && (
          <DeliveriesTable
            rows={rows}
            hasMore={hasMore}
            isFetching={deliveries.isFetching}
            onLoadMore={loadMore}
          />
        )}
      </VStack>
    </Drawer>
  );
}
