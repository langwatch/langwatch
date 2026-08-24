import {
  Badge,
  Box,
  Button,
  Card,
  HStack,
  Table,
  Text,
} from "@chakra-ui/react";
import { useMemo } from "react";
import { toaster } from "~/components/ui/toaster";
import { showErrorToast } from "~/features/errors";
import { useOpsPermission } from "~/hooks/useOpsPermission";
import { api } from "~/utils/api";
import {
  joinSubscriberHealth,
  type SubscriberHealthRow,
} from "./subscriberHealth";

function EventTypesCell({ eventTypes }: { eventTypes: readonly string[] }) {
  const shown = eventTypes.slice(0, 2);
  const more = eventTypes.length - shown.length;
  return (
    <HStack gap={1} title={eventTypes.join(", ")}>
      {shown.map((e) => (
        <Badge key={e} size="xs" variant="subtle" fontFamily="mono">
          {e}
        </Badge>
      ))}
      {more > 0 && (
        <Text textStyle="xs" color="fg.muted">
          +{more}
        </Text>
      )}
    </HStack>
  );
}

function SubscriberStatus({ row }: { row: SubscriberHealthRow }) {
  if (row.isPaused) {
    return (
      <Badge size="xs" colorPalette="yellow" variant="subtle">
        Paused
      </Badge>
    );
  }
  if (row.blocked > 0) {
    return (
      <Badge size="xs" colorPalette="red" variant="subtle">
        Blocked
      </Badge>
    );
  }
  if (row.hasLiveNode) {
    return (
      <Badge size="xs" colorPalette="green" variant="subtle">
        Live
      </Badge>
    );
  }
  return (
    <Badge size="xs" colorPalette="gray" variant="subtle">
      Idle
    </Badge>
  );
}

/** The pause/unpause mutations, shared by every row. */
function usePauseActions() {
  const utils = api.useUtils();
  const pauseMutation = api.ops.pausePipeline.useMutation({
    onSuccess: (_, vars) => {
      toaster.create({ title: `Paused ${vars.key}`, type: "success" });
      void utils.ops.invalidate();
    },
    onError: (error) =>
      showErrorToast({ error, fallbackTitle: "Couldn't pause the subscriber" }),
  });
  const unpauseMutation = api.ops.unpausePipeline.useMutation({
    onSuccess: (_, vars) => {
      toaster.create({ title: `Unpaused ${vars.key}`, type: "success" });
      void utils.ops.invalidate();
    },
    onError: (error) =>
      showErrorToast({
        error,
        fallbackTitle: "Couldn't unpause the subscriber",
      }),
  });
  return { pauseMutation, unpauseMutation };
}

function SubscriberPauseAction({
  row,
  queueName,
  actions,
}: {
  row: SubscriberHealthRow;
  queueName: string;
  actions: ReturnType<typeof usePauseActions>;
}) {
  const mutation = row.isPaused
    ? actions.unpauseMutation
    : actions.pauseMutation;
  return (
    <Button
      size="2xs"
      variant="outline"
      colorPalette={row.isPaused ? "green" : "yellow"}
      onClick={() => mutation.mutate({ queueName, key: row.pauseKey })}
      loading={mutation.isPending && mutation.variables?.key === row.pauseKey}
    >
      {row.isPaused ? "Unpause" : "Pause"}
    </Button>
  );
}

function SubscriberRow({
  row,
  queueName,
  hasAccess,
  actions,
}: {
  row: SubscriberHealthRow;
  queueName: string | undefined;
  hasAccess: boolean;
  actions: ReturnType<typeof usePauseActions>;
}) {
  return (
    <Table.Row bg={row.blocked > 0 ? "red.subtle" : undefined}>
      <Table.Cell>
        <Text textStyle="xs" fontFamily="mono">
          {row.subscriberName}
        </Text>
      </Table.Cell>
      <Table.Cell>
        <Text textStyle="xs" color="fg.muted">
          {row.pipelineName}
        </Text>
      </Table.Cell>
      <Table.Cell>
        <EventTypesCell eventTypes={row.eventTypes} />
      </Table.Cell>
      <Table.Cell textAlign="end">
        <Text textStyle="xs" fontFamily="mono">
          {row.pending}
        </Text>
      </Table.Cell>
      <Table.Cell textAlign="end">
        <Text textStyle="xs" fontFamily="mono">
          {row.active}
        </Text>
      </Table.Cell>
      <Table.Cell textAlign="end">
        <Text
          textStyle="xs"
          fontFamily="mono"
          color={row.blocked > 0 ? "red.solid" : "fg.muted"}
        >
          {row.blocked}
        </Text>
      </Table.Cell>
      <Table.Cell>
        <SubscriberStatus row={row} />
      </Table.Cell>
      {hasAccess && (
        <Table.Cell>
          {queueName && (
            <SubscriberPauseAction
              row={row}
              queueName={queueName}
              actions={actions}
            />
          )}
        </Table.Cell>
      )}
    </Table.Row>
  );
}

/**
 * Every REGISTERED subscriber with its live queue health — registry-driven so
 * a subscriber with no live jobs still appears, which the pipeline tree alone
 * cannot do (specs/ops/event-subscriber-visibility.feature).
 */
export function SubscribersCard() {
  const { hasAccess } = useOpsPermission();
  const registry = api.ops.listProjections.useQuery(undefined, {
    staleTime: 10 * 60 * 1000,
  });
  const dashboard = api.ops.getDashboardSnapshot.useQuery(undefined, {
    refetchInterval: 15_000,
  });
  const actions = usePauseActions();

  const rows = useMemo(
    () =>
      joinSubscriberHealth({
        subscribers: registry.data?.eventSubscribers ?? [],
        pipelineTree: dashboard.data?.pipelineTree ?? [],
        pausedKeys: dashboard.data?.pausedKeys ?? [],
      }),
    [registry.data, dashboard.data],
  );
  const queueName = dashboard.data?.queues[0]?.name;

  return (
    <Card.Root>
      <Card.Body padding={0}>
        <HStack
          paddingX={4}
          paddingY={2.5}
          borderBottom="1px solid"
          borderBottomColor="border"
        >
          <Text textStyle="sm" fontWeight="medium">
            Event Subscribers
          </Text>
        </HStack>
        {rows.length === 0 ? (
          <Box padding={4}>
            <Text textStyle="xs" color="fg.muted">
              No event subscribers registered.
            </Text>
          </Box>
        ) : (
          <Table.Root size="sm" variant="line">
            <Table.Header>
              <Table.Row>
                <Table.ColumnHeader>Subscriber</Table.ColumnHeader>
                <Table.ColumnHeader>Pipeline</Table.ColumnHeader>
                <Table.ColumnHeader>Events</Table.ColumnHeader>
                <Table.ColumnHeader textAlign="end">Pending</Table.ColumnHeader>
                <Table.ColumnHeader textAlign="end">Active</Table.ColumnHeader>
                <Table.ColumnHeader textAlign="end">Blocked</Table.ColumnHeader>
                <Table.ColumnHeader>Status</Table.ColumnHeader>
                {hasAccess && <Table.ColumnHeader>Actions</Table.ColumnHeader>}
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {rows.map((row) => (
                <SubscriberRow
                  key={row.pauseKey}
                  row={row}
                  queueName={queueName}
                  hasAccess={hasAccess}
                  actions={actions}
                />
              ))}
            </Table.Body>
          </Table.Root>
        )}
      </Card.Body>
    </Card.Root>
  );
}
