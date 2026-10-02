import { UiSlot } from "@langwatch/browser-host/slots";
import { ConfirmDialog } from "@langwatch/design-system/confirm-dialog";
import { Menu } from "@langwatch/design-system/menu";
import { NoDataInfoBlock } from "@langwatch/design-system/no-data-info-block";
import { PageLayout } from "@langwatch/design-system/page-layout";
import {
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Spacer,
  Table,
  Text,
  VStack,
} from "@langwatch/design-system/primitives";
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

import { api, type RouterOutputs } from "../../../behavior/gateway-api.ts";
import { useShowErrorToast } from "../../../behavior/gateway-feedback.ts";
import { useActivePlan, useOrganizationTeamProject } from "../../../behavior/gateway-session.ts";
import { WebhookDestinationCell } from "../../../features/webhooks/ui/elements/webhook-destination-cell.tsx";
import { WebhookDeliveriesDrawer } from "../../../features/webhooks/ui/sections/webhook-deliveries-drawer.tsx";
import { WebhookEndpointDrawer } from "../../../features/webhooks/ui/sections/webhook-endpoint-drawer.tsx";
import { WebhookSecretDialog } from "../../../features/webhooks/ui/sections/webhook-secret-dialog.tsx";
import { readableDate } from "../../../model/readable-date.ts";
import AiGatewayLayout from "../../../ui/sections/gateway-layout.tsx";
import { ListSkeleton } from "../../elements/list-skeleton.tsx";

type EndpointView = RouterOutputs["webhookEndpoints"]["list"][number];
type EventTypesView = RouterOutputs["webhookEndpoints"]["eventTypes"];

function statusBadge(endpoint: EndpointView) {
  if (endpoint.status === "ACTIVE") {
    return <Badge colorPalette="green">active</Badge>;
  }
  return (
    <Badge colorPalette="red" data-testid={`webhook-disabled-${endpoint.id}`}>
      {endpoint.disabledReason === "auto_failures_72h" ? "disabled: 72h of failures" : "disabled"}
    </Badge>
  );
}

function eventsSummary(enabledEvents: string[]) {
  if (enabledEvents.includes("*")) return "all events";
  const shown = enabledEvents.slice(0, 2).join(", ");
  const rest = enabledEvents.length - 2;
  return rest > 0 ? `${shown} +${rest}` : shown;
}

/** Which endpoint each drawer and confirmation is showing, if any. */
function useWebhookDialogs() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<EndpointView | null>(null);
  const [viewingDeliveries, setViewingDeliveries] = useState<EndpointView | null>(null);
  const [revealedSecret, setRevealedSecret] = useState<string | null>(null);
  const [rollingSecret, setRollingSecret] = useState<EndpointView | null>(null);
  const [deleting, setDeleting] = useState<EndpointView | null>(null);

  return {
    drawerOpen,
    setDrawerOpen,
    editing,
    viewingDeliveries,
    setViewingDeliveries,
    revealedSecret,
    setRevealedSecret,
    rollingSecret,
    setRollingSecret,
    deleting,
    setDeleting,
    openCreate: () => {
      setEditing(null);
      setDrawerOpen(true);
    },
    openEdit: (endpoint: EndpointView) => {
      setEditing(endpoint);
      setDrawerOpen(true);
    },
    closeDrawer: () => {
      setDrawerOpen(false);
      setEditing(null);
    },
  };
}

/**
 * Every mutation the endpoint list offers. Each one refreshes the list first
 * and then hands over, so the caller's dialog closes on a server-confirmed
 * change and stays open on a failure.
 */
function useWebhookEndpointMutations(handlers: {
  onCreated: (secret: string) => void;
  onUpdated: () => void;
  onSecretRolled: (secret: string) => void;
  onArchived: () => void;
}) {
  const showErrorToast = useShowErrorToast();
  const utils = api.useUtils();
  const refresh = () => void utils.webhookEndpoints.list.invalidate();
  const onError = (error: unknown) =>
    showErrorToast({ error, fallbackTitle: "That webhook change failed" });

  const create = api.webhookEndpoints.create.useMutation({
    onSuccess: ({ secret }) => {
      refresh();
      handlers.onCreated(secret);
    },
    onError,
  });
  const update = api.webhookEndpoints.update.useMutation({
    onSuccess: () => {
      refresh();
      handlers.onUpdated();
    },
    onError,
  });
  const rollSecret = api.webhookEndpoints.rollSecret.useMutation({
    onSuccess: ({ secret }) => {
      refresh();
      handlers.onSecretRolled(secret);
    },
    onError,
  });
  const enable = api.webhookEndpoints.enable.useMutation({
    onSuccess: refresh,
    onError,
  });
  const disable = api.webhookEndpoints.disable.useMutation({
    onSuccess: refresh,
    onError,
  });
  const archive = api.webhookEndpoints.archive.useMutation({
    onSuccess: () => {
      refresh();
      handlers.onArchived();
    },
    onError,
  });

  return { create, update, rollSecret, enable, disable, archive };
}

type WebhookDialogs = ReturnType<typeof useWebhookDialogs>;
type WebhookMutations = ReturnType<typeof useWebhookEndpointMutations>;

/** What acting on the endpoints in the list takes. */
type EndpointListActions = {
  organizationId: string;
  canManage: boolean;
  dialogs: WebhookDialogs;
  mutations: WebhookMutations;
};

type EndpointActionProps = EndpointListActions & { endpoint: EndpointView };

function WebhooksUpsell() {
  return (
    <>
      <PageLayout.Header>
        <PageLayout.Heading>Webhooks</PageLayout.Heading>
      </PageLayout.Header>
      <PageLayout.Container>
        <VStack gap={6} width="full" align="start">
          <Alert.Root status="info">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Title>Enterprise Feature</Alert.Title>
              <Alert.Description>
                Webhook endpoints stream signed events (gateway billing, budgets, key lifecycle) to
                your systems with durable retries and delivery history. Available on Enterprise
                plans.
              </Alert.Description>
            </Alert.Content>
          </Alert.Root>
          <Box width="full">
            <UiSlot name="contactSales" props={{}} />
          </Box>
        </VStack>
      </PageLayout.Container>
    </>
  );
}

function NoWebhookEndpointsState() {
  return (
    <NoDataInfoBlock
      title="No webhook endpoints"
      description="Create an endpoint to receive signed event batches."
      icon={<Webhook />}
    />
  );
}

/** The endpoint's own switch, whichever way it currently sits. */
function WebhookStatusMenuItem({ endpoint, organizationId, mutations }: EndpointActionProps) {
  if (endpoint.status === "ACTIVE") {
    return (
      <Menu.Item
        value="disable"
        data-testid="webhook-menu-disable"
        onClick={() => mutations.disable.mutate({ organizationId, endpointId: endpoint.id })}
      >
        <Pause size={14} /> Disable
      </Menu.Item>
    );
  }
  return (
    <Menu.Item
      value="enable"
      data-testid="webhook-menu-enable"
      onClick={() => mutations.enable.mutate({ organizationId, endpointId: endpoint.id })}
    >
      <Play size={14} /> Enable
    </Menu.Item>
  );
}

/** The actions behind the manage permission. */
function WebhookManageMenuItems(props: EndpointActionProps) {
  const { endpoint, dialogs } = props;
  return (
    <>
      <Menu.Item
        value="edit"
        data-testid="webhook-menu-edit"
        onClick={() => dialogs.openEdit(endpoint)}
      >
        <Pencil size={14} /> Edit
      </Menu.Item>
      <Menu.Item
        value="roll-secret"
        data-testid="webhook-menu-roll-secret"
        onClick={() => dialogs.setRollingSecret(endpoint)}
      >
        <RotateCw size={14} /> Roll secret
      </Menu.Item>
      <WebhookStatusMenuItem {...props} />
      <Menu.Item
        value="delete"
        color="fg.error"
        data-testid="webhook-menu-delete"
        onClick={() => dialogs.setDeleting(endpoint)}
      >
        <Trash2 size={14} /> Delete
      </Menu.Item>
    </>
  );
}

function WebhookRowMenu(props: EndpointActionProps) {
  const { endpoint, canManage, dialogs } = props;
  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        <Button variant="ghost" size="xs" aria-label="Actions" data-testid="webhook-row-actions">
          <MoreVertical size={14} />
        </Button>
      </Menu.Trigger>
      <Menu.Content>
        <Menu.Item
          value="deliveries"
          data-testid="webhook-menu-deliveries"
          onClick={() => dialogs.setViewingDeliveries(endpoint)}
        >
          <History size={14} /> Deliveries
        </Menu.Item>
        {canManage && <WebhookManageMenuItems {...props} />}
      </Menu.Content>
    </Menu.Root>
  );
}

function WebhookRow(props: EndpointActionProps) {
  const { endpoint } = props;
  return (
    <Table.Row>
      <WebhookDestinationCell endpoint={endpoint} />
      <Table.Cell>
        <Text fontSize="sm" color="fg.muted">
          {eventsSummary(endpoint.enabledEvents)}
        </Text>
      </Table.Cell>
      <Table.Cell>{statusBadge(endpoint)}</Table.Cell>
      <Table.Cell whiteSpace="nowrap">
        {endpoint.lastSuccessAt ? readableDate(endpoint.lastSuccessAt).toLocaleString() : "never"}
      </Table.Cell>
      <Table.Cell>
        <WebhookRowMenu {...props} />
      </Table.Cell>
    </Table.Row>
  );
}

function WebhookEndpointsTable({
  endpoints,
  ...actions
}: EndpointListActions & { endpoints: EndpointView[] }) {
  return (
    <Card.Root width="full" overflowX="auto">
      <Table.Root variant="line" size="md" width="full">
        <Table.Header>
          <Table.Row>
            <Table.ColumnHeader>Destination</Table.ColumnHeader>
            <Table.ColumnHeader>Events</Table.ColumnHeader>
            <Table.ColumnHeader>Status</Table.ColumnHeader>
            <Table.ColumnHeader>Last success</Table.ColumnHeader>
            <Table.ColumnHeader width="1%"></Table.ColumnHeader>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {endpoints.map((endpoint) => (
            <WebhookRow key={endpoint.id} endpoint={endpoint} {...actions} />
          ))}
        </Table.Body>
      </Table.Root>
    </Card.Root>
  );
}

function WebhookEndpointsPanel({
  endpoints,
  isLoading,
  ...actions
}: EndpointListActions & {
  endpoints: EndpointView[] | undefined;
  isLoading: boolean;
}) {
  return (
    <>
      <PageLayout.Header>
        <PageLayout.Heading>Webhooks</PageLayout.Heading>
        <Spacer />
        {actions.canManage && (
          <PageLayout.HeaderButton onClick={actions.dialogs.openCreate} data-testid="webhook-new">
            <Plus size={14} /> New endpoint
          </PageLayout.HeaderButton>
        )}
      </PageLayout.Header>

      <PageLayout.Container>
        <VStack gap={6} width="full" align="stretch">
          <Text color="fg.muted">
            Your systems that receive signed gateway events: billing, budgets and key lifecycle,
            with retries and delivery history.
          </Text>
          {isLoading && <ListSkeleton />}

          {endpoints && endpoints.length === 0 && <NoWebhookEndpointsState />}

          {endpoints && endpoints.length > 0 && (
            <WebhookEndpointsTable endpoints={endpoints} {...actions} />
          )}
        </VStack>
      </PageLayout.Container>
    </>
  );
}

/** Rolling the secret breaks receivers until they carry the new value. */
function RollSecretDialog({
  endpoint,
  organizationId,
  mutation,
  onClose,
}: {
  endpoint: EndpointView | null;
  organizationId: string;
  mutation: WebhookMutations["rollSecret"];
  onClose: () => void;
}) {
  return (
    <ConfirmDialog
      open={!!endpoint}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Roll the signing secret?"
      message={`Receivers verifying ${endpoint?.url ?? "this endpoint"} start rejecting signatures the moment the secret rolls, until the new value is configured. The new secret is shown once.`}
      confirmLabel="Roll secret"
      tone="warning"
      loading={mutation.isPending}
      onConfirm={() => {
        if (!endpoint) return;
        // The dialog closes in onSuccess, so the loading state renders
        // and a failure leaves it open instead of masquerading as done.
        mutation.mutate({ organizationId, endpointId: endpoint.id });
      }}
    />
  );
}

/** Deleting stops delivery for good; the emitted events stay pullable. */
function DeleteEndpointDialog({
  endpoint,
  organizationId,
  mutation,
  onClose,
}: {
  endpoint: EndpointView | null;
  organizationId: string;
  mutation: WebhookMutations["archive"];
  onClose: () => void;
}) {
  return (
    <ConfirmDialog
      open={!!endpoint}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Delete this endpoint?"
      message={`${endpoint?.url ?? "This endpoint"} stops receiving events. Emitted events stay pullable, but nothing is delivered here again.`}
      confirmLabel="Delete endpoint"
      tone="danger"
      loading={mutation.isPending}
      onConfirm={() => {
        if (!endpoint) return;
        mutation.mutate({ organizationId, endpointId: endpoint.id });
      }}
    />
  );
}

function WebhookDialogsStack({
  organizationId,
  eventTypes,
  dialogs,
  mutations,
}: {
  organizationId: string;
  eventTypes: EventTypesView | undefined;
  dialogs: WebhookDialogs;
  mutations: WebhookMutations;
}) {
  return (
    <>
      <WebhookEndpointDrawer
        isOpen={dialogs.drawerOpen}
        endpoint={dialogs.editing}
        eventTypes={eventTypes}
        isSaving={mutations.create.isPending || mutations.update.isPending}
        onClose={dialogs.closeDrawer}
        onSave={({ destinationKind, ...input }) => {
          if (dialogs.editing) {
            // The kind is not sent on an update: it cannot change, and the
            // drawer locked the control, so repeating it would only give the
            // server something to refuse.
            mutations.update.mutate({
              organizationId,
              endpointId: dialogs.editing.id,
              ...input,
            });
          } else {
            mutations.create.mutate({
              organizationId,
              destinationKind,
              ...input,
            });
          }
        }}
      />
      <WebhookDeliveriesDrawer
        organizationId={organizationId}
        endpoint={dialogs.viewingDeliveries}
        onClose={() => dialogs.setViewingDeliveries(null)}
      />
      <WebhookSecretDialog
        secret={dialogs.revealedSecret}
        onClose={() => dialogs.setRevealedSecret(null)}
      />
      <RollSecretDialog
        endpoint={dialogs.rollingSecret}
        organizationId={organizationId}
        mutation={mutations.rollSecret}
        onClose={() => dialogs.setRollingSecret(null)}
      />
      <DeleteEndpointDialog
        endpoint={dialogs.deleting}
        organizationId={organizationId}
        mutation={mutations.archive}
        onClose={() => dialogs.setDeleting(null)}
      />
    </>
  );
}

/**
 * The endpoint list and everything that changes it: the create/edit drawer,
 * the delivery history, the shown-once secret, and the confirmations behind
 * rolling a secret or deleting an endpoint.
 */
function WebhooksManager({
  organizationId,
  enabled,
  canManage,
}: {
  organizationId: string;
  enabled: boolean;
  canManage: boolean;
}) {
  const dialogs = useWebhookDialogs();
  const endpoints = api.webhookEndpoints.list.useQuery({ organizationId }, { enabled });
  const eventTypes = api.webhookEndpoints.eventTypes.useQuery({ organizationId }, { enabled });
  const mutations = useWebhookEndpointMutations({
    onCreated: (secret) => {
      dialogs.setDrawerOpen(false);
      dialogs.setRevealedSecret(secret);
    },
    onUpdated: dialogs.closeDrawer,
    onSecretRolled: (secret) => {
      dialogs.setRollingSecret(null);
      dialogs.setRevealedSecret(secret);
    },
    onArchived: () => dialogs.setDeleting(null),
  });

  return (
    <>
      <WebhookEndpointsPanel
        endpoints={endpoints.data}
        isLoading={endpoints.isLoading}
        organizationId={organizationId}
        canManage={canManage}
        dialogs={dialogs}
        mutations={mutations}
      />
      <WebhookDialogsStack
        organizationId={organizationId}
        eventTypes={eventTypes.data}
        dialogs={dialogs}
        mutations={mutations}
      />
    </>
  );
}

export default function WebhooksSettingsPage() {
  const { organization, hasPermission } = useOrganizationTeamProject();
  const { webhookEndpointsEnabled, isLoading: isPlanLoading } = useActivePlan();
  const webhooksEnabled = webhookEndpointsEnabled;

  if (isPlanLoading) {
    return (
      <AiGatewayLayout>
        <PageLayout.Header>
          <PageLayout.Heading>Webhooks</PageLayout.Heading>
        </PageLayout.Header>
        <PageLayout.Container>
          <ListSkeleton />
        </PageLayout.Container>
      </AiGatewayLayout>
    );
  }

  if (!webhooksEnabled) {
    return (
      <AiGatewayLayout>
        <WebhooksUpsell />
      </AiGatewayLayout>
    );
  }

  return (
    <AiGatewayLayout>
      <WebhooksManager
        organizationId={organization?.id ?? ""}
        enabled={!!organization}
        canManage={hasPermission("webhookEndpoints:manage")}
      />
    </AiGatewayLayout>
  );
}
