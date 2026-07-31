import {
  Badge,
  Box,
  Button,
  Heading,
  HStack,
  Spinner,
  Table,
  Text,
  VStack,
} from "@chakra-ui/react";
import { useEffect, useState } from "react";

import { Drawer } from "~/components/ui/drawer";
import { api, type RouterOutputs } from "~/utils/api";

const DELIVERIES_PAGE_SIZE = 25;

type EndpointView = RouterOutputs["webhookEndpoints"]["list"][number];

function outcomeBadge(outcome: string) {
  const palette =
    outcome === "success" ? "green" : outcome === "terminal" ? "red" : "orange";
  return (
    <Badge size="sm" colorPalette={palette}>
      {outcome}
    </Badge>
  );
}

function formatWhen(date: Date | string) {
  return new Date(date).toLocaleString();
}

function formatAge(ms: number) {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  return `${(ms / 3_600_000).toFixed(1)}h`;
}

/**
 * Read-only delivery history for one endpoint: the health strip on top,
 * then one row per attempt with the receiver's own status code, latency,
 * and error excerpt. The rows are the WebhookEndpointDelivery log the
 * delivery process manager records on every attempt.
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
  const [cursor, setCursor] = useState<
    { firedAt: Date; id: string } | undefined
  >(undefined);
  // A fresh endpoint resets pagination to the first page.
  useEffect(() => {
    setCursor(undefined);
  }, [endpoint?.id]);
  const deliveries = api.webhookEndpoints.deliveries.useQuery(
    {
      organizationId,
      endpointId: endpoint?.id ?? "",
      limit: DELIVERIES_PAGE_SIZE,
      cursor,
    },
    { enabled: endpoint !== null },
  );
  const health = api.webhookEndpoints.health.useQuery(
    {
      organizationId,
      endpointId: endpoint?.id ?? "",
    },
    { enabled: endpoint !== null, refetchInterval: 15_000 },
  );

  return (
    <Drawer.Root
      placement="end"
      size="lg"
      open={endpoint !== null}
      onOpenChange={({ open }) => {
        if (!open) onClose();
      }}
    >
      <Drawer.Content bg="bg">
        <Drawer.Header>
          <Heading size="md">Deliveries</Heading>
          <Drawer.CloseTrigger />
        </Drawer.Header>
        <Drawer.Body>
          <VStack align="start" gap={4} width="full">
            {endpoint && (
              <VStack
                align="start"
                gap={1}
                width="full"
                data-testid="webhook-health-strip"
              >
                <Text fontSize="sm" color="fg.muted" wordBreak="break-all">
                  {endpoint.url}
                </Text>
                <HStack gap={4} fontSize="sm" flexWrap="wrap">
                  <HStack gap={1} data-testid="webhook-health-lag">
                    <Text color="fg.muted">Lag:</Text>
                    <Text
                      fontWeight="600"
                      color={
                        (health.data?.oldestUndeliveredAgeMs ?? 0) > 300_000
                          ? "fg.error"
                          : undefined
                      }
                    >
                      {health.data
                        ? health.data.oldestUndeliveredAgeMs === null
                          ? "caught up"
                          : formatAge(health.data.oldestUndeliveredAgeMs)
                        : "..."}
                    </Text>
                  </HStack>
                  {(health.data?.dlqDepth ?? 0) > 0 && (
                    <Badge colorPalette="red" data-testid="webhook-dlq-badge">
                      {health.data!.dlqDepth} dead-lettered
                    </Badge>
                  )}
                  <HStack gap={1}>
                    <Text color="fg.muted">Sends/min:</Text>
                    <Text>
                      {health.data
                        ? health.data.sendsPerMinute.toFixed(2)
                        : "..."}
                    </Text>
                  </HStack>
                  <HStack gap={1}>
                    <Text color="fg.muted">Success:</Text>
                    <Text>
                      {health.data
                        ? health.data.successRate === null
                          ? "n/a"
                          : `${Math.round(health.data.successRate * 100)}%`
                        : "..."}
                    </Text>
                  </HStack>
                  <HStack gap={1}>
                    <Text color="fg.muted">p95:</Text>
                    <Text>
                      {health.data
                        ? health.data.p95LatencyMs === null
                          ? "n/a"
                          : `${health.data.p95LatencyMs}ms`
                        : "..."}
                    </Text>
                  </HStack>
                  <HStack gap={1}>
                    <Text color="fg.muted">Last success:</Text>
                    <Text>
                      {endpoint.lastSuccessAt
                        ? formatWhen(endpoint.lastSuccessAt)
                        : "never"}
                    </Text>
                  </HStack>
                  <HStack gap={1}>
                    <Text color="fg.muted">Failing since:</Text>
                    <Text>
                      {endpoint.failingSince
                        ? formatWhen(endpoint.failingSince)
                        : "not failing"}
                    </Text>
                  </HStack>
                  {endpoint.status === "DISABLED" && (
                    <Badge
                      colorPalette="red"
                      data-testid="webhook-disabled-badge"
                    >
                      disabled
                      {endpoint.disabledReason === "auto_failures_72h"
                        ? ": 72h of failures"
                        : ""}
                    </Badge>
                  )}
                </HStack>
              </VStack>
            )}

            {deliveries.isLoading && <Spinner size="sm" />}
            {deliveries.data &&
              deliveries.data.deliveries.length === 0 &&
              !cursor && (
                <Text fontSize="sm" color="fg.muted">
                  No deliveries recorded in the last 30 days.
                </Text>
              )}
            {deliveries.data && deliveries.data.deliveries.length > 0 && (
              <Box width="full" overflowX="auto">
                <Table.Root size="sm">
                  <Table.Header>
                    <Table.Row>
                      <Table.ColumnHeader>Fired</Table.ColumnHeader>
                      <Table.ColumnHeader>Attempt</Table.ColumnHeader>
                      <Table.ColumnHeader>Events</Table.ColumnHeader>
                      <Table.ColumnHeader>Outcome</Table.ColumnHeader>
                      <Table.ColumnHeader>Status</Table.ColumnHeader>
                      <Table.ColumnHeader>Latency</Table.ColumnHeader>
                      <Table.ColumnHeader>Error</Table.ColumnHeader>
                    </Table.Row>
                  </Table.Header>
                  <Table.Body>
                    {deliveries.data.deliveries.map((d) => (
                      <Table.Row key={d.id}>
                        <Table.Cell whiteSpace="nowrap">
                          {formatWhen(d.firedAt)}
                        </Table.Cell>
                        <Table.Cell>{d.attempt}</Table.Cell>
                        <Table.Cell>{d.eventCount}</Table.Cell>
                        <Table.Cell>{outcomeBadge(d.outcome)}</Table.Cell>
                        <Table.Cell>{d.responseStatus ?? ""}</Table.Cell>
                        <Table.Cell>
                          {d.latencyMs !== null ? `${d.latencyMs}ms` : ""}
                        </Table.Cell>
                        <Table.Cell
                          maxWidth="240px"
                          overflow="hidden"
                          textOverflow="ellipsis"
                          whiteSpace="nowrap"
                          title={d.error ?? undefined}
                        >
                          {d.error ?? ""}
                        </Table.Cell>
                      </Table.Row>
                    ))}
                  </Table.Body>
                </Table.Root>
                {deliveries.data.nextCursor && (
                  <Button
                    size="xs"
                    variant="outline"
                    marginTop={2}
                    loading={deliveries.isFetching}
                    onClick={() =>
                      setCursor(deliveries.data?.nextCursor ?? undefined)
                    }
                    data-testid="webhook-deliveries-load-more"
                  >
                    Load more
                  </Button>
                )}
              </Box>
            )}
          </VStack>
        </Drawer.Body>
      </Drawer.Content>
    </Drawer.Root>
  );
}
