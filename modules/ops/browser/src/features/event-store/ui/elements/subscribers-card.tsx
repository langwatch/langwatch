import { Card } from "@langwatch/design-system/card";
import { InlineCode } from "@langwatch/design-system/inline-code";
import { ListTable } from "@langwatch/design-system/list-table";
import { NoDataInfoBlock } from "@langwatch/design-system/no-data-info-block";
import { Badge, Button, HStack, Text } from "@langwatch/design-system/primitives";
import { Radio } from "lucide-react";

import type { SubscriberHealthRow } from "../../model/subscriber-health.ts";

function EventTypesCell({ eventTypes }: { eventTypes: readonly string[] }) {
  const shown = eventTypes.slice(0, 2);
  const more = eventTypes.length - shown.length;
  return (
    <HStack gap={1} title={eventTypes.join(", ")}>
      {shown.map((e) => (
        <Badge key={e} size="xs" variant="subtle">
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
      size="sm"
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
    <ListTable.Row tone={row.blocked > 0 ? "danger" : undefined}>
      <ListTable.Cell>
        <InlineCode variant="neutral">{row.subscriberName}</InlineCode>
      </ListTable.Cell>
      <ListTable.Cell>
        <Text textStyle="xs" color="fg.muted">
          {row.pipelineName}
        </Text>
      </ListTable.Cell>
      <ListTable.Cell>
        <EventTypesCell eventTypes={row.eventTypes} />
      </ListTable.Cell>
      <ListTable.Cell align="end">
        <Text textStyle="caption" fontVariantNumeric="tabular-nums">
          {row.pending}
        </Text>
      </ListTable.Cell>
      <ListTable.Cell align="end">
        <Text textStyle="caption" fontVariantNumeric="tabular-nums">
          {row.active}
        </Text>
      </ListTable.Cell>
      <ListTable.Cell align="end">
        <Text
          textStyle="caption"
          fontVariantNumeric="tabular-nums"
          color={row.blocked > 0 ? "fg.error" : "fg.muted"}
        >
          {row.blocked}
        </Text>
      </ListTable.Cell>
      <ListTable.Cell>
        <SubscriberStatus row={row} />
      </ListTable.Cell>
      {hasAccess && (
        <ListTable.Cell>
          {queueName && onTogglePause && (
            <SubscriberPauseAction
              row={row}
              queueName={queueName}
              onTogglePause={onTogglePause}
              isPausePending={isPausePending ?? false}
            />
          )}
        </ListTable.Cell>
      )}
    </ListTable.Row>
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
    <Card padding="none">
      <HStack paddingX={4} paddingY={2.5} borderBottom="1px solid" borderBottomColor="border">
        <Text textStyle="sm" fontWeight="medium">
          Event subscribers
        </Text>
      </HStack>
      {rows.length === 0 ? (
        <NoDataInfoBlock
          icon={<Radio />}
          title="No event subscribers registered."
          description="Registered subscribers and their delivery status appear here."
        />
      ) : (
        <ListTable density="compact" variant="embedded" scroll="x" scrollLabel="Event subscribers">
          <ListTable.Header>
            <ListTable.Row>
              <ListTable.ColumnHeader>Subscriber</ListTable.ColumnHeader>
              <ListTable.ColumnHeader>Pipeline</ListTable.ColumnHeader>
              <ListTable.ColumnHeader>Events</ListTable.ColumnHeader>
              <ListTable.ColumnHeader align="end">Pending</ListTable.ColumnHeader>
              <ListTable.ColumnHeader align="end">Active</ListTable.ColumnHeader>
              <ListTable.ColumnHeader align="end">Blocked</ListTable.ColumnHeader>
              <ListTable.ColumnHeader>Status</ListTable.ColumnHeader>
              {hasAccess && <ListTable.ColumnHeader>Actions</ListTable.ColumnHeader>}
            </ListTable.Row>
          </ListTable.Header>
          <ListTable.Body>
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
          </ListTable.Body>
        </ListTable>
      )}
    </Card>
  );
}
