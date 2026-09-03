import { Badge, Box, Button, Card, HStack, Table, Text } from "@chakra-ui/react";
import type { SubscriberHealthRow } from "../../model/subscriber-health";

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

function SubscriberPauseAction({
  row,
  queueName,
  onTogglePause,
  isPausePending,
}: {
  row: SubscriberHealthRow;
  queueName: string;
  onTogglePause: (row: SubscriberHealthRow, queueName: string) => void;
  isPausePending: boolean;
}) {
  return (
    <Button
      size="2xs"
      variant="outline"
      colorPalette={row.isPaused ? "green" : "yellow"}
      onClick={() => onTogglePause(row, queueName)}
      loading={isPausePending}
    >
      {row.isPaused ? "Unpause" : "Pause"}
    </Button>
  );
}

function SubscriberRow({
  row,
  queueName,
  hasAccess,
  onTogglePause,
  isPausePending,
}: {
  row: SubscriberHealthRow;
  queueName: string | undefined;
  hasAccess: boolean;
  onTogglePause?: (row: SubscriberHealthRow, queueName: string) => void;
  isPausePending?: boolean;
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
        <Text textStyle="xs" fontFamily="mono" color={row.blocked > 0 ? "red.500" : "fg.muted"}>
          {row.blocked}
        </Text>
      </Table.Cell>
      <Table.Cell>
        <SubscriberStatus row={row} />
      </Table.Cell>
      {hasAccess && (
        <Table.Cell>
          {queueName && onTogglePause && (
            <SubscriberPauseAction
              row={row}
              queueName={queueName}
              onTogglePause={onTogglePause}
              isPausePending={isPausePending ?? false}
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
export function SubscribersCard({
  rows,
  queueName,
  hasAccess,
  onTogglePause,
  isPausePending,
}: {
  rows: SubscriberHealthRow[];
  queueName: string | undefined;
  hasAccess: boolean;
  onTogglePause?: (row: SubscriberHealthRow, queueName: string) => void;
  isPausePending?: (row: SubscriberHealthRow) => boolean;
}) {
  return (
    <Card.Root>
      <Card.Body padding={0}>
        <HStack paddingX={4} paddingY={2.5} borderBottom="1px solid" borderBottomColor="border">
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
                  onTogglePause={onTogglePause}
                  isPausePending={isPausePending?.(row)}
                />
              ))}
            </Table.Body>
          </Table.Root>
        )}
      </Card.Body>
    </Card.Root>
  );
}
