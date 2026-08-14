import { Box, Code, HStack, Skeleton, Text, VStack } from "@chakra-ui/react";
import { useState } from "react";
import { api, type RouterOutputs } from "~/utils/api";
import { formatTimeAgo } from "~/utils/formatTimeAgo";

type WebhookDelivery =
  RouterOutputs["automation"]["getWebhookDeliveries"][number];

const OUTCOME_DOT: Record<WebhookDelivery["outcome"], string> = {
  success: "green.solid",
  retryable: "yellow.solid",
  terminal: "red.solid",
  pending: "gray.solid",
};

/**
 * The per-attempt webhook delivery log (ADR-040 §6), for webhook automations
 * only. Lifted out of the drawer body when the view grew a real history: the
 * drawer composes sections now, and each section owns its own read.
 */
export function WebhookDeliverySection({
  automationId,
  projectId,
}: {
  automationId: string;
  projectId: string;
}) {
  const deliveriesQuery = api.automation.getWebhookDeliveries.useQuery(
    { triggerId: automationId, projectId, limit: 50 },
    { enabled: !!projectId },
  );
  const deliveries = deliveriesQuery.data ?? [];

  return (
    <VStack align="start" gap={2} width="full">
      <Text textStyle="xs" color="fg.muted" fontWeight="medium">
        Recent deliveries
      </Text>
      {deliveriesQuery.isLoading ? (
        <Skeleton height="60px" width="full" />
      ) : deliveries.length === 0 ? (
        <Text textStyle="sm" color="fg.muted">
          No delivery attempts recorded yet.
        </Text>
      ) : (
        <WebhookDeliveriesList deliveries={deliveries} />
      )}
    </VStack>
  );
}

/**
 * The webhook delivery log (ADR-040 §6): attempts grouped by the fire that
 * produced them (`dispatchId`), newest fire first. A failed attempt expands
 * to its error, the truncated response the receiver sent back (body and
 * headers — debugging context the server stores capped), and a
 * plain-language explanation of what went wrong. What is never stored or
 * shown is OUR request content: the rendered body and its headers can carry
 * credentials.
 */
function WebhookDeliveriesList({
  deliveries,
}: {
  deliveries: WebhookDelivery[];
}) {
  // Rows arrive newest-first. Group by dispatchId keeping first-seen order
  // (newest fire on top); reverse each group so attempts read oldest→newest.
  const groups: { dispatchId: string; attempts: WebhookDelivery[] }[] = [];
  const byId = new Map<string, WebhookDelivery[]>();
  for (const d of deliveries) {
    let attempts = byId.get(d.dispatchId);
    if (!attempts) {
      attempts = [];
      byId.set(d.dispatchId, attempts);
      groups.push({ dispatchId: d.dispatchId, attempts });
    }
    attempts.push(d);
  }
  for (const g of groups) g.attempts.reverse();

  return (
    <VStack align="stretch" gap={2} width="full">
      {groups.map((g) => (
        <VStack
          key={g.dispatchId}
          align="stretch"
          gap={0}
          width="full"
          borderWidth="1px"
          borderColor="border"
          borderRadius="md"
          overflow="hidden"
        >
          {g.attempts.map((attempt, index) => (
            <DeliveryAttemptRow
              key={attempt.id}
              attempt={attempt}
              index={index}
              total={g.attempts.length}
            />
          ))}
        </VStack>
      ))}
    </VStack>
  );
}

/** Plain-language guidance derived from the HTTP status bucket — what
 *  happened and what the operator can do about it. Transport failures carry
 *  their own self-explanatory error text instead. */
function guidanceForStatus(status: number | null): string | undefined {
  if (status === null) return undefined;
  if (status === 429)
    return "The endpoint asked us to slow down. Delivery backs off and retries.";
  if (status === 408 || status >= 500)
    return "The endpoint had a server error. Delivery retries automatically.";
  if (status >= 400)
    return "The endpoint rejected the request. Check its authentication and the payload it expects.";
  return undefined;
}

function DeliveryAttemptRow({
  attempt,
  index,
  total,
}: {
  attempt: WebhookDelivery;
  index: number;
  total: number;
}) {
  const [open, setOpen] = useState(false);
  const statusText =
    attempt.responseStatus != null
      ? `HTTP ${attempt.responseStatus}`
      : (attempt.error ?? "No response");
  const guidance =
    attempt.outcome === "success"
      ? undefined
      : guidanceForStatus(attempt.responseStatus);
  const hasDetail = Boolean(attempt.error ?? guidance ?? attempt.response);

  return (
    <Box
      borderBottomWidth="1px"
      borderColor="border"
      _last={{ borderBottomWidth: 0 }}
    >
      <HStack
        as="button"
        gap={2.5}
        paddingX={3}
        paddingY={2}
        width="full"
        textAlign="left"
        cursor={hasDetail ? "pointer" : "default"}
        onClick={() => hasDetail && setOpen((v) => !v)}
      >
        <Box
          boxSize={2}
          borderRadius="full"
          flexShrink={0}
          bg={OUTCOME_DOT[attempt.outcome]}
        />
        <Text textStyle="sm" flex="1" minWidth="0">
          {total > 1 ? `Attempt ${index + 1} · ` : ""}
          {statusText}
        </Text>
        <Text
          textStyle="xs"
          color="fg.muted"
          flexShrink={0}
          whiteSpace="nowrap"
        >
          {attempt.latencyMs != null ? `${attempt.latencyMs}ms · ` : ""}
          {formatTimeAgo(new Date(attempt.firedAt).getTime())}
        </Text>
      </HStack>
      {open && hasDetail ? (
        <DeliveryAttemptDetail attempt={attempt} guidance={guidance} />
      ) : null}
    </Box>
  );
}

/** The expanded body of a failed attempt: the stored error, the endpoint's
 *  response, and what the operator can do about it. */
function DeliveryAttemptDetail({
  attempt,
  guidance,
}: {
  attempt: WebhookDelivery;
  guidance: string | undefined;
}) {
  return (
    <VStack align="stretch" gap={2} paddingX={3} paddingBottom={3}>
      {attempt.error ? (
        <Code
          fontSize="xs"
          width="full"
          whiteSpace="pre-wrap"
          wordBreak="break-word"
        >
          {attempt.error}
        </Code>
      ) : null}
      {attempt.response?.body ? (
        <Code
          fontSize="xs"
          width="full"
          whiteSpace="pre-wrap"
          wordBreak="break-word"
        >
          {attempt.response.body}
        </Code>
      ) : null}
      {attempt.response?.headers ? (
        <VStack align="stretch" gap={0.5}>
          {Object.entries(attempt.response.headers).map(([name, value]) => (
            <Code key={name} fontSize="xs" width="full" whiteSpace="pre-wrap">
              {name}: {value}
            </Code>
          ))}
        </VStack>
      ) : null}
      {guidance ? (
        <Text textStyle="xs" color="fg.muted">
          {guidance}
        </Text>
      ) : null}
    </VStack>
  );
}
