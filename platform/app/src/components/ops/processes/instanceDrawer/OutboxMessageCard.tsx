import {
  Badge,
  Box,
  Button,
  Card,
  HStack,
  Spacer,
  Text,
} from "@chakra-ui/react";
import { useState } from "react";
import { formatTimeAgo } from "~/components/ops/shared/formatters";
import { PinnedAwareJsonView } from "~/features/traces-v2/components/TraceDrawer/JsonHighlight";
import type { ProcessOutboxMessageView } from "~/server/app-layer/ops/repositories/process-ops.repository";
import {
  type GrafanaDeepLinkConfig,
  grafanaTraceUrl,
} from "~/utils/grafanaLinks";

const NO_PINNED_KEYS: ReadonlySet<string> = new Set();

/** Exhaustive by type, so the next status has to declare its own colour. */
const STATUS_PALETTES: Record<ProcessOutboxMessageView["status"], string> = {
  pending: "blue",
  dispatched: "green",
  dead: "red",
  discarded: "gray",
};

function StatusBadge({
  status,
}: {
  status: ProcessOutboxMessageView["status"];
}) {
  const palette = STATUS_PALETTES[status];
  return (
    <Badge size="xs" colorPalette={palette} variant="subtle">
      {status}
    </Badge>
  );
}

function MessageHeaderRow({
  message,
  now,
  showJson,
  onToggleJson,
}: {
  message: ProcessOutboxMessageView;
  now: number;
  showJson: boolean;
  onToggleJson: () => void;
}) {
  return (
    <HStack gap={2}>
      <Text
        textStyle="xs"
        fontFamily="mono"
        truncate
        title={message.messageKey}
      >
        {message.intentType}
      </Text>
      <StatusBadge status={message.status} />
      {message.attempts > 0 && (
        <Text textStyle="xs" color="orange.solid" fontFamily="mono">
          {message.attempts} attempts
        </Text>
      )}
      <Spacer />
      <Text textStyle="xs" color="fg.muted" flexShrink={0}>
        created {formatTimeAgo(message.createdAt, now)}
      </Text>
      <Button
        size="2xs"
        variant={showJson ? "solid" : "ghost"}
        onClick={onToggleJson}
        flexShrink={0}
      >
        JSON
      </Button>
    </HStack>
  );
}

function MessageMetaRow({
  message,
  now,
  leaseLapsed,
  traceHref,
  canManage,
  onRedrive,
  onDiscard,
  onReleaseLease,
  actionPending,
}: {
  message: ProcessOutboxMessageView;
  now: number;
  leaseLapsed: boolean;
  traceHref: string | null;
  canManage: boolean;
  onRedrive?: (messageId: string) => void;
  onDiscard?: (message: { id: string; intentType: string }) => void;
  onReleaseLease?: (messageId: string) => void;
  actionPending?: boolean;
}) {
  return (
    <HStack gap={2} flexWrap="wrap">
      {message.status === "pending" && (
        <Text textStyle="xs" color="fg.muted">
          next attempt {formatTimeAgo(message.nextAttemptAt, now)}
        </Text>
      )}
      {leaseLapsed && (
        <Badge
          size="xs"
          colorPalette="orange"
          variant="subtle"
          title="The dispatch lease expired without a completion. The outbox lease is not renewed mid-delivery, so the dispatcher died — or is still delivering."
        >
          lease lapsed — dispatcher died or still delivering
        </Badge>
      )}
      {traceHref && (
        <Text asChild textStyle="xs" color="blue.fg">
          <a href={traceHref} target="_blank" rel="noreferrer">
            producing trace ↗
          </a>
        </Text>
      )}
      {canManage && message.status === "dead" && onRedrive && (
        <Button
          size="2xs"
          variant="outline"
          colorPalette="green"
          loading={actionPending}
          onClick={() => onRedrive(message.id)}
        >
          Redrive
        </Button>
      )}
      {canManage && message.status === "dead" && onDiscard && (
        <Button
          size="2xs"
          variant="outline"
          colorPalette="red"
          loading={actionPending}
          title="A mark, not a delete: the row is kept as the audit record and the message is never sent."
          onClick={() =>
            onDiscard({ id: message.id, intentType: message.intentType })
          }
        >
          Discard
        </Button>
      )}
      {canManage && leaseLapsed && onReleaseLease && (
        <Button
          size="2xs"
          variant="outline"
          colorPalette="orange"
          loading={actionPending}
          title="If the holder is alive and slow, its completion after this release re-delivers; the message key absorbs the duplicate."
          onClick={() => onReleaseLease(message.id)}
        >
          Release lease
        </Button>
      )}
    </HStack>
  );
}

/**
 * One outbox message: what it intends, where it stands, and its producing
 * trace via the carrier captured at commit. The lapsed-lease wording is
 * deliberate — the outbox lease is not renewed mid-delivery, so a dead
 * dispatcher and a slow live one are indistinguishable until the fencing
 * check, and the card must not accuse the live one.
 */
export function OutboxMessageCard({
  message,
  now,
  grafana,
  canManage,
  onRedrive,
  onDiscard,
  onReleaseLease,
  actionPending,
}: {
  message: ProcessOutboxMessageView;
  now: number;
  grafana?: GrafanaDeepLinkConfig | null;
  canManage: boolean;
  onRedrive?: (messageId: string) => void;
  onDiscard?: (message: { id: string; intentType: string }) => void;
  onReleaseLease?: (messageId: string) => void;
  actionPending?: boolean;
}) {
  const [showJson, setShowJson] = useState(false);
  const leaseLapsed =
    message.status === "pending" &&
    message.leasedUntil !== null &&
    message.leasedUntil < now;
  const traceHref =
    message.traceId && grafana
      ? grafanaTraceUrl(message.traceId, grafana)
      : null;

  return (
    <Card.Root variant="outline">
      <Card.Body padding={2.5} gap={2}>
        <MessageHeaderRow
          message={message}
          now={now}
          showJson={showJson}
          onToggleJson={() => setShowJson((v) => !v)}
        />
        <MessageMetaRow
          message={message}
          now={now}
          leaseLapsed={leaseLapsed}
          traceHref={traceHref}
          canManage={canManage}
          onRedrive={onRedrive}
          onDiscard={onDiscard}
          onReleaseLease={onReleaseLease}
          actionPending={actionPending}
        />
        {showJson && (
          <Box
            bg="bg.subtle"
            borderRadius="sm"
            padding={2}
            maxHeight="240px"
            overflow="auto"
          >
            <PinnedAwareJsonView
              content={JSON.stringify(message.payload)}
              pinnedKeys={NO_PINNED_KEYS}
            />
          </Box>
        )}
      </Card.Body>
    </Card.Root>
  );
}
