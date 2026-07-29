import {
  Badge,
  Box,
  Heading,
  HStack,
  Spinner,
  Table,
  Text,
  VStack,
} from "@chakra-ui/react";

import { Drawer } from "~/components/ui/drawer";
import { api, type RouterOutputs } from "~/utils/api";

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
  const deliveries = api.webhookEndpoints.deliveries.useQuery(
    {
      organizationId,
      endpointId: endpoint?.id ?? "",
      limit: 100,
    },
    { enabled: endpoint !== null },
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
                    <Badge colorPalette="red" data-testid="webhook-disabled-badge">
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
            {deliveries.data && deliveries.data.length === 0 && (
              <Text fontSize="sm" color="fg.muted">
                No deliveries recorded in the last 30 days.
              </Text>
            )}
            {deliveries.data && deliveries.data.length > 0 && (
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
                    {deliveries.data.map((d) => (
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
              </Box>
            )}
          </VStack>
        </Drawer.Body>
      </Drawer.Content>
    </Drawer.Root>
  );
}
