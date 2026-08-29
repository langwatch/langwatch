import { Box, Button, Center, HStack, Spinner, Text, VStack } from "@chakra-ui/react";
import { formatTimeAgo } from "@langwatch/ops-web";
import { PinnedAwareJsonView } from "~/features/traces-v2/components/TraceDrawer/JsonHighlight";
import type { ProcessInstanceDetail } from "@langwatch/ops-contract";
import type { ProcessOutboxMessageView } from "@langwatch/ops-contract";
import type { GrafanaDeepLinkConfig } from "~/utils/grafanaLinks";
import { describeNextWake } from "@langwatch/ops-web";
import { OutboxMessageCard } from "./OutboxMessageCard";

const NO_PINNED_KEYS: ReadonlySet<string> = new Set();

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <VStack align="start" gap={0}>
      <Text textStyle="xs" color="fg.muted">
        {label}
      </Text>
      {children}
    </VStack>
  );
}

function InstanceStatusRow({ detail, now }: { detail: ProcessInstanceDetail; now: number }) {
  const wakeOverdue = detail.nextWakeAt !== null && detail.nextWakeAt < now;
  return (
    <HStack gap={4} flexWrap="wrap">
      <Field label="Revision">
        <Text textStyle="sm" fontFamily="mono">
          {detail.revision}
        </Text>
      </Field>
      <Field label="Next wake">
        <Text
          textStyle="sm"
          color={wakeOverdue ? "orange.500" : undefined}
          fontWeight={wakeOverdue ? "medium" : undefined}
        >
          {describeNextWake(detail.nextWakeAt, now)}
        </Text>
      </Field>
      <Field label="Updated">
        <Text textStyle="sm">{formatTimeAgo(detail.updatedAt, now)}</Text>
      </Field>
      <Field label="Project">
        <Text textStyle="xs" fontFamily="mono">
          {detail.ref.projectId}
        </Text>
      </Field>
    </HStack>
  );
}

interface OutboxSectionProps {
  outbox: { messages: ProcessOutboxMessageView[]; total: number } | null;
  outboxLoading: boolean;
  page: number;
  pageSize: number;
  onPageChange?: (page: number) => void;
  grafana?: GrafanaDeepLinkConfig | null;
  canManage: boolean;
  onRedriveMessage?: (messageId: string) => void;
  onDiscardMessage?: (message: { id: string; intentType: string }) => void;
  onReleaseLease?: (messageId: string) => void;
  actionPending?: boolean;
  now: number;
}

function InstanceOutboxSection({
  outbox,
  outboxLoading,
  page,
  pageSize,
  onPageChange,
  grafana,
  canManage,
  onRedriveMessage,
  onDiscardMessage,
  onReleaseLease,
  actionPending,
  now,
}: OutboxSectionProps) {
  const total = outbox?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(total, page * pageSize);

  return (
    <VStack align="stretch" gap={1.5}>
      <HStack gap={2}>
        <Text textStyle="xs" color="fg.muted">
          Outbox {total > 0 ? `(${first}–${last} of ${total})` : "(0)"}
        </Text>
        {onPageChange && pageCount > 1 && (
          <HStack gap={1} marginLeft="auto">
            <Button
              size="2xs"
              variant="outline"
              disabled={page <= 1}
              onClick={() => onPageChange(page - 1)}
            >
              Previous
            </Button>
            <Button
              size="2xs"
              variant="outline"
              disabled={page >= pageCount}
              onClick={() => onPageChange(page + 1)}
            >
              Next
            </Button>
          </HStack>
        )}
      </HStack>
      {outboxLoading ? (
        <Spinner size="xs" />
      ) : outbox && outbox.messages.length > 0 ? (
        <VStack align="stretch" gap={2}>
          {outbox.messages.map((message) => (
            <OutboxMessageCard
              key={message.id}
              message={message}
              now={now}
              grafana={grafana}
              canManage={canManage}
              onRedrive={onRedriveMessage}
              onDiscard={onDiscardMessage}
              onReleaseLease={onReleaseLease}
              actionPending={actionPending}
            />
          ))}
        </VStack>
      ) : (
        <Text textStyle="xs" color="fg.muted">
          No outbox messages.
        </Text>
      )}
    </VStack>
  );
}

/**
 * The drawer body, separated from the queries so it renders (and tests)
 * against plain data. State is shown as JSON directly — it is
 * identities-and-flags by the substrate's content boundary, and its shape is
 * different for every process, so a structured view would just be a worse
 * JSON.
 */
export function ProcessInstanceContent({
  detail,
  isLoading,
  outbox,
  outboxLoading,
  outboxPage,
  outboxPageSize,
  onOutboxPageChange,
  grafana,
  canManage,
  onRedriveMessage,
  onDiscardMessage,
  onReleaseLease,
  actionPending,
  now = Date.now(),
}: {
  detail: ProcessInstanceDetail | null;
  isLoading: boolean;
  outbox: { messages: ProcessOutboxMessageView[]; total: number } | null;
  outboxLoading: boolean;
  outboxPage?: number;
  outboxPageSize?: number;
  onOutboxPageChange?: (page: number) => void;
  grafana?: GrafanaDeepLinkConfig | null;
  canManage?: boolean;
  onRedriveMessage?: (messageId: string) => void;
  onDiscardMessage?: (message: { id: string; intentType: string }) => void;
  onReleaseLease?: (messageId: string) => void;
  actionPending?: boolean;
  now?: number;
}) {
  if (isLoading) {
    return (
      <Center paddingY={6}>
        <Spinner size="sm" />
      </Center>
    );
  }

  if (!detail) {
    return (
      <Text textStyle="sm" color="fg.muted" data-testid="process-instance-missing">
        This process instance no longer exists — retention reaped it, or it was never started for
        this key.
      </Text>
    );
  }

  return (
    <VStack align="stretch" gap={4}>
      <InstanceStatusRow detail={detail} now={now} />

      <VStack align="stretch" gap={1}>
        <Text textStyle="xs" color="fg.muted">
          State
        </Text>
        <Box bg="bg.subtle" borderRadius="sm" padding={2} maxHeight="280px" overflow="auto">
          <PinnedAwareJsonView content={JSON.stringify(detail.state)} pinnedKeys={NO_PINNED_KEYS} />
        </Box>
      </VStack>

      <InstanceOutboxSection
        outbox={outbox}
        outboxLoading={outboxLoading}
        page={outboxPage ?? 1}
        pageSize={outboxPageSize ?? 20}
        onPageChange={onOutboxPageChange}
        grafana={grafana}
        canManage={canManage ?? false}
        onRedriveMessage={onRedriveMessage}
        onDiscardMessage={onDiscardMessage}
        onReleaseLease={onReleaseLease}
        actionPending={actionPending}
        now={now}
      />
    </VStack>
  );
}
