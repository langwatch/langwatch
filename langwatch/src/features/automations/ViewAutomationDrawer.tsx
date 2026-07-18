import {
  Badge,
  Box,
  Button,
  Code,
  HStack,
  Heading,
  Skeleton,
  Spacer,
  Text,
  VStack,
} from "@chakra-ui/react";
import { TriggerKind } from "@prisma/client";
import { differenceInMinutes, differenceInSeconds } from "date-fns";
import { useState } from "react";
import { Calendar, TrendingUp } from "react-feather";
import { CLIENT_PROVIDERS } from "~/features/automations/providers/registry";
import { FilterDisplay } from "~/components/automations/FilterDisplay";
import { Drawer } from "~/components/ui/drawer";
import { Tooltip } from "~/components/ui/tooltip";
import {
  OPERATOR_LABELS,
  TIME_PERIOD_LABELS,
} from "~/features/automations/logic/draftReducer";
import { resolveSeriesLabel } from "~/features/automations/logic/seriesOptions";
import type { TriggerActionParams } from "~/features/automations/logic/triggerActionParams";
import { useDrawer } from "~/hooks/useDrawer";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api, type RouterOutputs } from "~/utils/api";
import { formatTimeAgo } from "~/utils/formatTimeAgo";

interface ViewAutomationDrawerProps {
  automationId: string;
}

/**
 * How long an incident stayed open, as compact copy for the fire list
 * ("resolved after 15m"). Sub-minute incidents show seconds so a fast
 * recovery doesn't read as "resolved after 0m".
 */
function formatDurationBetween(from: Date, to: Date): string {
  const minutes = differenceInMinutes(to, from);
  if (minutes < 1) return `${Math.max(differenceInSeconds(to, from), 1)}s`;
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest > 0 ? `${hours}h ${rest}m` : `${hours}h`;
}

/** Parse the trigger's legacy structured-filters JSON string, tolerating
 *  malformed payloads (returns null so the caller falls back to the empty
 *  state instead of crashing the drawer). */
function parseFiltersObject(filters: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(filters);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

export function ViewAutomationDrawer({
  automationId,
}: ViewAutomationDrawerProps) {
  const { project } = useOrganizationTeamProject();
  const { openDrawer, closeDrawer } = useDrawer();

  const triggerQuery = api.automation.getTriggerById.useQuery(
    { triggerId: automationId, projectId: project?.id ?? "" },
    { enabled: !!project?.id },
  );
  const recentFiresQuery = api.automation.getRecentFires.useQuery(
    { triggerId: automationId, projectId: project?.id ?? "", limit: 20 },
    { enabled: !!project?.id },
  );
  // ADR-040 §6: the per-attempt delivery log, only for webhook automations.
  const webhookDeliveriesQuery = api.automation.getWebhookDeliveries.useQuery(
    { triggerId: automationId, projectId: project?.id ?? "", limit: 50 },
    {
      enabled:
        !!project?.id && triggerQuery.data?.action === "SEND_WEBHOOK",
    },
  );

  const trigger = triggerQuery.data;
  const isGraphAlert = !!trigger?.customGraphId;
  const isWebhook = trigger?.action === "SEND_WEBHOOK";
  const isSchedule = trigger?.triggerKind === TriggerKind.REPORT;
  const actionParams = (trigger?.actionParams ?? {}) as TriggerActionParams;

  // Resolve the watched graph's JSON so the stored series key renders as its
  // human label (falls back to the raw key when the graph is gone), and the
  // dataset name so ADD_TO_DATASET destinations don't show a bare cuid.
  const graphQuery = api.graphs.getById.useQuery(
    { projectId: project?.id ?? "", id: trigger?.customGraphId ?? "" },
    { enabled: !!project?.id && !!trigger?.customGraphId, retry: false },
  );
  const datasetsQuery = api.dataset.getAll.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project?.id && trigger?.action === "ADD_TO_DATASET" },
  );
  const datasetName = actionParams.datasetId
    ? (datasetsQuery.data?.find((d) => d.id === actionParams.datasetId)?.name ??
      null)
    : null;

  const destinationSummary = (): React.ReactNode => {
    if (!trigger) return null;
    switch (trigger.action) {
      case "SEND_SLACK_MESSAGE":
        // The webhook URL carries a secret token — mask it and surface the
        // full URL only on hover, mirroring the list page's Slack cell.
        return actionParams.slackWebhook ? (
          <Tooltip content={actionParams.slackWebhook}>
            <Text textStyle="sm" lineClamp={1} width="fit-content" cursor="help">
              Slack webhook
            </Text>
          </Tooltip>
        ) : (
          <Text textStyle="sm">Slack webhook</Text>
        );
      case "SEND_EMAIL":
        return actionParams.members?.length ? (
          <Text textStyle="sm" wordBreak="break-all">
            {actionParams.members.join(", ")}
          </Text>
        ) : null;
      case "SEND_WEBHOOK": {
        let hostname = "Webhook";
        try {
          hostname = actionParams.url
            ? new URL(actionParams.url).hostname
            : hostname;
        } catch {
          // Stored rows are validated; retain a safe label for legacy data.
        }
        return (
          <Text textStyle="sm" wordBreak="break-all">
            {actionParams.method ?? "POST"} {hostname}
          </Text>
        );
      }
      case "ADD_TO_DATASET":
        return datasetName ? <Text textStyle="sm">{datasetName}</Text> : null;
      case "ADD_TO_ANNOTATION_QUEUE":
        return actionParams.annotators?.length ? (
          <Text textStyle="sm" wordBreak="break-all">
            {actionParams.annotators.map((a) => a.name).join(", ")}
          </Text>
        ) : null;
      default:
        return null;
    }
  };

  const conditionsSummary = () => {
    if (!trigger) return null;
    if (isGraphAlert) {
      const operator = actionParams.operator
        ? OPERATOR_LABELS[actionParams.operator]
        : null;
      const window = actionParams.timePeriod
        ? TIME_PERIOD_LABELS[actionParams.timePeriod]
        : null;
      const seriesLabel = actionParams.seriesName
        ? (resolveSeriesLabel(graphQuery.data?.graph, actionParams.seriesName) ??
          actionParams.seriesName)
        : "Metric";
      return (
        <Text textStyle="sm">
          {seriesLabel}
          {operator ? ` ${operator}` : ""}
          {actionParams.threshold !== undefined
            ? ` ${actionParams.threshold}`
            : ""}
          {window ? ` over ${window}` : ""}
        </Text>
      );
    }
    if (trigger.filterQuery) {
      // ADR-043: a trace-subject automation shows its search query, mirroring
      // the automations page's "Acts on" cell.
      return (
        <Code
          size="sm"
          variant="surface"
          whiteSpace="pre-wrap"
          wordBreak="break-word"
        >
          {trigger.filterQuery}
        </Code>
      );
    }
    // Legacy structured filters are stored as a JSON string — "{}" (no
    // conditions) is truthy, so emptiness has to be checked on the parsed
    // object or the "No conditions" fallback is unreachable.
    if (trigger.filters && typeof trigger.filters === "string") {
      const parsed = parseFiltersObject(trigger.filters);
      if (parsed && Object.keys(parsed).length > 0) {
        return <FilterDisplay filters={trigger.filters} hasBorder={true} />;
      }
    }
    return (
      <Text textStyle="sm" color="fg.muted">
        No conditions
      </Text>
    );
  };

  return (
    <Drawer.Root
      open={true}
      placement="end"
      size="md"
      onOpenChange={({ open }) => {
        if (!open) closeDrawer();
      }}
    >
      <Drawer.Content bg="bg">
        <Drawer.Header>
          <Drawer.CloseTrigger />
          <VStack align="start" gap={1}>
            {triggerQuery.isLoading ? (
              <Skeleton height="24px" width="200px" />
            ) : (
              <Heading size="md">
                {trigger?.name ??
                  (isGraphAlert ? "Alert" : isSchedule ? "Schedule" : "Automation")}
              </Heading>
            )}
            {isGraphAlert ? (
              <Badge colorPalette="purple" gap={1}>
                <TrendingUp size={12} />
                Alert
              </Badge>
            ) : isSchedule ? (
              <Badge colorPalette="purple" gap={1}>
                <Calendar size={12} />
                Schedule
              </Badge>
            ) : trigger ? (
              <Badge colorPalette="gray">Automation</Badge>
            ) : null}
          </VStack>
        </Drawer.Header>
        <Drawer.Body>
          <VStack align="stretch" gap={6}>
            <VStack align="start" gap={1}>
              <Text textStyle="xs" color="fg.muted" fontWeight="medium">
                Type
              </Text>
              <Text textStyle="sm">
                {trigger
                  ? (CLIENT_PROVIDERS[trigger.action]?.shared.label ??
                    trigger.action)
                  : null}
              </Text>
            </VStack>

            <VStack align="start" gap={1}>
              <Text textStyle="xs" color="fg.muted" fontWeight="medium">
                Destination
              </Text>
              {destinationSummary() ?? <Text textStyle="sm">None</Text>}
            </VStack>

            <VStack align="start" gap={1} width="full">
              <Text textStyle="xs" color="fg.muted" fontWeight="medium">
                Conditions
              </Text>
              {conditionsSummary()}
            </VStack>

            <VStack align="start" gap={2} width="full">
              <Text textStyle="xs" color="fg.muted" fontWeight="medium">
                Recent fires
              </Text>
              {recentFiresQuery.isLoading ? (
                <Skeleton height="60px" width="full" />
              ) : (recentFiresQuery.data ?? []).length === 0 ? (
                <Text textStyle="sm" color="fg.muted">
                  {isGraphAlert
                    ? "This alert has not fired yet."
                    : "This automation has not fired yet."}
                </Text>
              ) : (
                <RecentFiresList
                  fires={recentFiresQuery.data ?? []}
                  isGraphAlert={isGraphAlert}
                />
              )}
            </VStack>

            {isWebhook ? (
              <VStack align="start" gap={2} width="full">
                <Text textStyle="xs" color="fg.muted" fontWeight="medium">
                  Recent deliveries
                </Text>
                {webhookDeliveriesQuery.isLoading ? (
                  <Skeleton height="60px" width="full" />
                ) : (webhookDeliveriesQuery.data ?? []).length === 0 ? (
                  <Text textStyle="sm" color="fg.muted">
                    No delivery attempts recorded yet.
                  </Text>
                ) : (
                  <WebhookDeliveriesList
                    deliveries={webhookDeliveriesQuery.data ?? []}
                  />
                )}
              </VStack>
            ) : null}
          </VStack>
        </Drawer.Body>
        <Drawer.Footer>
          <HStack width="full">
            <Spacer />
            <Button
              colorPalette="orange"
              onClick={() => openDrawer("automation", { automationId })}
            >
              Edit
            </Button>
          </HStack>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer.Root>
  );
}

type RecentFire = RouterOutputs["automation"]["getRecentFires"][number];

/**
 * Recent fires as a compact, honest list. The fire ledger is metadata-only
 * (no trace ids: `triggers:view` is weaker than trace-content permission), so
 * there is nothing per-trace to link. A busy automation logs many rows that
 * otherwise read as identical "fired 6 minutes ago" lines, so a burst that
 * shares a relative-time label collapses into one "Fired 7 times" row. Alerts
 * stay per-incident because each open/resolve is a distinct event.
 */
function RecentFiresList({
  fires,
  isGraphAlert,
}: {
  fires: RecentFire[];
  isGraphAlert: boolean;
}) {
  const rows = isGraphAlert
    ? fires.map((fire) => {
        const firedAt = new Date(fire.createdAt);
        const open = !fire.resolvedAt;
        return {
          key: fire.id,
          dot: open ? "red.solid" : "green.solid",
          label: open ? "Firing" : "Resolved",
          detail: open
            ? "still firing"
            : `${formatTimeAgo(firedAt.getTime())} · lasted ${formatDurationBetween(
                firedAt,
                new Date(fire.resolvedAt!),
              )}`,
          detailColor: open ? "red.fg" : "fg.muted",
        };
      })
    : groupFiresByLabel(fires).map((g) => ({
        key: g.key,
        dot: "green.solid",
        label: g.count === 1 ? "Fired once" : `Fired ${g.count} times`,
        detail: g.label,
        detailColor: "fg.muted",
      }));

  return (
    <VStack
      align="stretch"
      gap={0}
      width="full"
      borderWidth="1px"
      borderColor="border"
      borderRadius="md"
      overflow="hidden"
    >
      {rows.map((row) => (
        <HStack
          key={row.key}
          gap={2.5}
          paddingX={3}
          paddingY={2}
          borderBottomWidth="1px"
          borderColor="border"
          _last={{ borderBottomWidth: 0 }}
        >
          <Box boxSize={2} borderRadius="full" flexShrink={0} bg={row.dot} />
          <Text textStyle="sm" flex="1" minWidth="0">
            {row.label}
          </Text>
          <Text
            textStyle="xs"
            color={row.detailColor}
            flexShrink={0}
            whiteSpace="nowrap"
          >
            {row.detail}
          </Text>
        </HStack>
      ))}
    </VStack>
  );
}

/** Collapse consecutive fires that share a relative-time label ("6 minutes
 *  ago") into one counted row. Input is newest-first, so equal labels are
 *  always adjacent. */
function groupFiresByLabel(
  fires: RecentFire[],
): { key: string; label: string; count: number }[] {
  const groups: { key: string; label: string; count: number }[] = [];
  for (const fire of fires) {
    const label = formatTimeAgo(new Date(fire.createdAt).getTime()) ?? "";
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.count++;
    else groups.push({ key: fire.id, label, count: 1 });
  }
  return groups;
}

type WebhookDelivery =
  RouterOutputs["automation"]["getWebhookDeliveries"][number];

const OUTCOME_DOT: Record<WebhookDelivery["outcome"], string> = {
  success: "green.solid",
  retryable: "yellow.solid",
  terminal: "red.solid",
  pending: "gray.solid",
};

/**
 * The webhook delivery log (ADR-040 §6): attempts grouped by the fire that
 * produced them (`dispatchId`), newest fire first. A failed attempt expands
 * to its error and a plain-language explanation of what went wrong — the log
 * stores outcome facts only, never request or response content.
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

/** Plain-language guidance per failure classification — what happened and
 *  what the operator can do about it. */
const FAILURE_KIND_GUIDANCE: Record<string, string> = {
  blocked_url:
    "This URL points somewhere LangWatch won't deliver to — private networks and redirects are blocked. Check the destination URL.",
  timeout:
    "The endpoint didn't answer in time. Make sure it responds quickly; delivery retries automatically.",
  network:
    "The endpoint couldn't be reached. Check the URL and that your receiver is up.",
  rate_limited:
    "The endpoint asked us to slow down. Delivery backs off and retries.",
  client_error:
    "The endpoint rejected the request. Check its authentication and the payload it expects.",
  server_error:
    "The endpoint had a server error. Delivery retries automatically.",
};

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
  const guidance = attempt.failureKind
    ? FAILURE_KIND_GUIDANCE[attempt.failureKind]
    : undefined;
  const hasDetail = Boolean(attempt.error ?? guidance);

  return (
    <Box borderBottomWidth="1px" borderColor="border" _last={{ borderBottomWidth: 0 }}>
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
        <Text textStyle="xs" color="fg.muted" flexShrink={0} whiteSpace="nowrap">
          {attempt.latencyMs != null ? `${attempt.latencyMs}ms · ` : ""}
          {formatTimeAgo(new Date(attempt.firedAt).getTime())}
        </Text>
      </HStack>
      {open && hasDetail ? (
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
          {guidance ? (
            <Text textStyle="xs" color="fg.muted">
              {guidance}
            </Text>
          ) : null}
        </VStack>
      ) : null}
    </Box>
  );
}
