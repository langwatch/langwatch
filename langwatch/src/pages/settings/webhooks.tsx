import {
  Alert,
  Badge,
  Box,
  Button,
  EmptyState,
  Heading,
  HStack,
  Spinner,
  Table,
  Text,
  VStack,
} from "@chakra-ui/react";
import {
  History,
  MoreVertical,
  Pause,
  Pencil,
  Play,
  Plus,
  RotateCw,
  Trash2,
  Webhook,
} from "lucide-react";
import { useState } from "react";
import { ConfirmDialog } from "~/components/gateway/ConfirmDialog";
import SettingsLayout from "~/components/SettingsLayout";
import { ContactSalesBlock } from "~/components/subscription/ContactSalesBlock";
import { Menu } from "~/components/ui/menu";
import { toaster } from "~/components/ui/toaster";
import { WebhookDeliveriesDrawer } from "~/components/webhooks/WebhookDeliveriesDrawer";
import { WebhookEndpointDrawer } from "~/components/webhooks/WebhookEndpointDrawer";
import { WebhookSecretDialog } from "~/components/webhooks/WebhookSecretDialog";
import { useActivePlan } from "~/hooks/useActivePlan";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api, type RouterOutputs } from "~/utils/api";

type EndpointView = RouterOutputs["webhookEndpoints"]["list"][number];

function statusBadge(endpoint: EndpointView) {
  if (endpoint.status === "ACTIVE") {
    return <Badge colorPalette="green">active</Badge>;
  }
  return (
    <Badge colorPalette="red" data-testid={`webhook-disabled-${endpoint.id}`}>
      {endpoint.disabledReason === "auto_failures_72h"
        ? "disabled: 72h of failures"
        : "disabled"}
    </Badge>
  );
}

function eventsSummary(enabledEvents: string[]) {
  if (enabledEvents.includes("*")) return "all events";
  const shown = enabledEvents.slice(0, 2).join(", ");
  const rest = enabledEvents.length - 2;
  return rest > 0 ? `${shown} +${rest}` : shown;
}

export default function WebhooksSettingsPage() {
  const { organization, hasPermission } = useOrganizationTeamProject();
  const { activePlan, isLoading: isPlanLoading } = useActivePlan();
  const organizationId = organization?.id ?? "";
  const webhooksEnabled = activePlan?.webhookEndpointsEnabled === true;
  const canManage = hasPermission("webhookEndpoints:manage");

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<EndpointView | null>(null);
  const [viewingDeliveries, setViewingDeliveries] =
    useState<EndpointView | null>(null);
  const [revealedSecret, setRevealedSecret] = useState<string | null>(null);
  const [rollingSecret, setRollingSecret] = useState<EndpointView | null>(null);
  const [deleting, setDeleting] = useState<EndpointView | null>(null);

  const utils = api.useContext();
  const enabled = !!organization && webhooksEnabled;
  const endpoints = api.webhookEndpoints.list.useQuery(
    { organizationId },
    { enabled },
  );
  const eventTypes = api.webhookEndpoints.eventTypes.useQuery(
    { organizationId },
    { enabled },
  );

  const refresh = () => void utils.webhookEndpoints.list.invalidate();
  const onError = (error: { message: string }) =>
    toaster.create({
      title: error.message,
      type: "error",
      meta: { closable: true },
    });

  const createMutation = api.webhookEndpoints.create.useMutation({
    onSuccess: ({ secret }) => {
      refresh();
      setDrawerOpen(false);
      setRevealedSecret(secret);
    },
    onError,
  });
  const updateMutation = api.webhookEndpoints.update.useMutation({
    onSuccess: () => {
      refresh();
      setDrawerOpen(false);
      setEditing(null);
    },
    onError,
  });
  const rollSecretMutation = api.webhookEndpoints.rollSecret.useMutation({
    onSuccess: ({ secret }) => {
      refresh();
      setRollingSecret(null);
      setRevealedSecret(secret);
    },
    onError,
  });
  const enableMutation = api.webhookEndpoints.enable.useMutation({
    onSuccess: refresh,
    onError,
  });
  const disableMutation = api.webhookEndpoints.disable.useMutation({
    onSuccess: refresh,
    onError,
  });
  const archiveMutation = api.webhookEndpoints.archive.useMutation({
    onSuccess: () => {
      refresh();
      setDeleting(null);
    },
    onError,
  });

  if (isPlanLoading) {
    return (
      <SettingsLayout>
        <VStack align="center" justify="center" width="full" height="200px">
          <Spinner />
        </VStack>
      </SettingsLayout>
    );
  }

  if (!webhooksEnabled) {
    return (
      <SettingsLayout>
        <VStack gap={6} width="full" align="start" paddingY={6} paddingX={4}>
          <Heading size="lg">Webhooks</Heading>
          <Alert.Root status="info">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Title>Enterprise Feature</Alert.Title>
              <Alert.Description>
                Webhook endpoints stream signed events (gateway billing,
                budgets, key lifecycle) to your systems with durable retries and
                delivery history. Available on Enterprise plans.
              </Alert.Description>
            </Alert.Content>
          </Alert.Root>
          <Box width="full">
            <ContactSalesBlock />
          </Box>
        </VStack>
      </SettingsLayout>
    );
  }

  return (
    <SettingsLayout>
      <VStack gap={6} width="full" align="start" paddingY={6} paddingX={4}>
        <HStack width="full" justify="space-between">
          <Heading size="lg">Webhooks</Heading>
          {canManage && (
            <Button
              colorPalette="orange"
              size="sm"
              onClick={() => {
                setEditing(null);
                setDrawerOpen(true);
              }}
              data-testid="webhook-new"
            >
              <Plus size={14} /> New endpoint
            </Button>
          )}
        </HStack>

        {endpoints.isLoading && <Spinner size="sm" />}

        {endpoints.data && endpoints.data.length === 0 && (
          <EmptyState.Root>
            <EmptyState.Content>
              <EmptyState.Indicator>
                <Webhook />
              </EmptyState.Indicator>
              <EmptyState.Title>No webhook endpoints</EmptyState.Title>
              <EmptyState.Description>
                Create an endpoint to receive signed event batches.
              </EmptyState.Description>
            </EmptyState.Content>
          </EmptyState.Root>
        )}

        {endpoints.data && endpoints.data.length > 0 && (
          <Box width="full" overflowX="auto">
            <Table.Root size="sm">
              <Table.Header>
                <Table.Row>
                  <Table.ColumnHeader>URL</Table.ColumnHeader>
                  <Table.ColumnHeader>Events</Table.ColumnHeader>
                  <Table.ColumnHeader>Status</Table.ColumnHeader>
                  <Table.ColumnHeader>Last success</Table.ColumnHeader>
                  <Table.ColumnHeader width="1%"></Table.ColumnHeader>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {endpoints.data.map((endpoint) => (
                  <Table.Row key={endpoint.id}>
                    <Table.Cell
                      maxWidth="320px"
                      overflow="hidden"
                      textOverflow="ellipsis"
                      whiteSpace="nowrap"
                      title={endpoint.url}
                    >
                      {endpoint.url}
                    </Table.Cell>
                    <Table.Cell>
                      <Text fontSize="sm" color="fg.muted">
                        {eventsSummary(endpoint.enabledEvents)}
                      </Text>
                    </Table.Cell>
                    <Table.Cell>{statusBadge(endpoint)}</Table.Cell>
                    <Table.Cell whiteSpace="nowrap">
                      {endpoint.lastSuccessAt
                        ? new Date(endpoint.lastSuccessAt).toLocaleString()
                        : "never"}
                    </Table.Cell>
                    <Table.Cell>
                      <Menu.Root>
                        <Menu.Trigger asChild>
                          <Button
                            variant="ghost"
                            size="xs"
                            aria-label="Actions"
                          >
                            <MoreVertical size={14} />
                          </Button>
                        </Menu.Trigger>
                        <Menu.Content>
                          <Menu.Item
                            value="deliveries"
                            onClick={() => setViewingDeliveries(endpoint)}
                          >
                            <History size={14} /> Deliveries
                          </Menu.Item>
                          {canManage && (
                            <>
                              <Menu.Item
                                value="edit"
                                onClick={() => {
                                  setEditing(endpoint);
                                  setDrawerOpen(true);
                                }}
                              >
                                <Pencil size={14} /> Edit
                              </Menu.Item>
                              <Menu.Item
                                value="roll-secret"
                                onClick={() => setRollingSecret(endpoint)}
                              >
                                <RotateCw size={14} /> Roll secret
                              </Menu.Item>
                              {endpoint.status === "ACTIVE" ? (
                                <Menu.Item
                                  value="disable"
                                  onClick={() =>
                                    disableMutation.mutate({
                                      organizationId,
                                      endpointId: endpoint.id,
                                    })
                                  }
                                >
                                  <Pause size={14} /> Disable
                                </Menu.Item>
                              ) : (
                                <Menu.Item
                                  value="enable"
                                  onClick={() =>
                                    enableMutation.mutate({
                                      organizationId,
                                      endpointId: endpoint.id,
                                    })
                                  }
                                >
                                  <Play size={14} /> Enable
                                </Menu.Item>
                              )}
                              <Menu.Item
                                value="delete"
                                color="fg.error"
                                onClick={() => setDeleting(endpoint)}
                              >
                                <Trash2 size={14} /> Delete
                              </Menu.Item>
                            </>
                          )}
                        </Menu.Content>
                      </Menu.Root>
                    </Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table.Root>
          </Box>
        )}
      </VStack>

      <WebhookEndpointDrawer
        isOpen={drawerOpen}
        endpoint={editing}
        eventTypes={eventTypes.data}
        isSaving={createMutation.isPending || updateMutation.isPending}
        onClose={() => {
          setDrawerOpen(false);
          setEditing(null);
        }}
        onSave={({
          url,
          enabledEvents,
          maxBatchSize,
          maxBatchDelayMs,
          maxInFlight,
        }) => {
          if (editing) {
            updateMutation.mutate({
              organizationId,
              endpointId: editing.id,
              url,
              enabledEvents,
              maxBatchSize,
              maxBatchDelayMs,
              maxInFlight,
            });
          } else {
            createMutation.mutate({
              organizationId,
              url,
              enabledEvents,
              maxBatchSize,
              maxBatchDelayMs,
              maxInFlight,
            });
          }
        }}
      />
      <WebhookDeliveriesDrawer
        organizationId={organizationId}
        endpoint={viewingDeliveries}
        onClose={() => setViewingDeliveries(null)}
      />
      <WebhookSecretDialog
        secret={revealedSecret}
        onClose={() => setRevealedSecret(null)}
      />
      <ConfirmDialog
        open={!!rollingSecret}
        onOpenChange={(open) => {
          if (!open) setRollingSecret(null);
        }}
        title="Roll the signing secret?"
        message={`Receivers verifying ${rollingSecret?.url ?? "this endpoint"} start rejecting signatures the moment the secret rolls, until the new value is configured. The new secret is shown once.`}
        confirmLabel="Roll secret"
        tone="warning"
        loading={rollSecretMutation.isPending}
        onConfirm={() => {
          if (!rollingSecret) return;
          // The dialog closes in onSuccess, so the loading state renders
          // and a failure leaves it open instead of masquerading as done.
          rollSecretMutation.mutate({
            organizationId,
            endpointId: rollingSecret.id,
          });
        }}
      />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        title="Delete this endpoint?"
        message={`${deleting?.url ?? "This endpoint"} stops receiving events. Emitted events stay pullable, but nothing is delivered here again.`}
        confirmLabel="Delete endpoint"
        tone="danger"
        loading={archiveMutation.isPending}
        onConfirm={() => {
          if (!deleting) return;
          archiveMutation.mutate({
            organizationId,
            endpointId: deleting.id,
          });
        }}
      />
    </SettingsLayout>
  );
}
