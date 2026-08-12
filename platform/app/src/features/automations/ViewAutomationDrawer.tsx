import {
  Badge,
  Button,
  Code,
  Heading,
  HStack,
  Skeleton,
  Spacer,
  Text,
  VStack,
} from "@chakra-ui/react";
import { TriggerKind } from "@prisma/client";
import { Calendar, TrendingUp } from "react-feather";
import { FilterDisplay } from "~/components/automations/FilterDisplay";
import { Drawer } from "~/components/ui/drawer";
import { Tooltip } from "~/components/ui/tooltip";
import { HistorySection } from "~/features/automations/components/view/HistorySection";
import { MatchingTracesSection } from "~/features/automations/components/view/MatchingTracesSection";
import { NextFiringSection } from "~/features/automations/components/view/NextFiringSection";
import { WebhookDeliverySection } from "~/features/automations/components/view/WebhookDeliverySection";
import {
  OPERATOR_LABELS,
  TIME_PERIOD_LABELS,
} from "~/features/automations/logic/draftReducer";
import {
  isAutomationPauseReason,
  RUNAWAY_PAUSE_EXPLANATION,
} from "~/features/automations/logic/pauseReasons";
import { resolveSeriesLabel } from "~/features/automations/logic/seriesOptions";
import { slackDestinationPresentation } from "~/features/automations/logic/slackDestinationPresentation";
import type { TriggerActionParams } from "~/features/automations/logic/triggerActionParams";
import { CLIENT_PROVIDERS } from "~/features/automations/providers/registry";
import { useDrawer } from "~/hooks/useDrawer";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";

interface ViewAutomationDrawerProps {
  automationId: string;
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
  const trigger = triggerQuery.data;
  const isGraphAlert = !!trigger?.customGraphId;
  const isWebhook = trigger?.action === "SEND_WEBHOOK";
  const isSchedule = trigger?.triggerKind === TriggerKind.REPORT;
  const actionParams = (trigger?.actionParams ?? {}) as TriggerActionParams;
  // The conditions can only be re-run for an automation whose subject IS a
  // trace search query (ADR-043). A graph alert watches a metric, and a
  // legacy `filters` row has no query to run — both simply get no control.
  const traceQuery = !isGraphAlert ? (trigger?.filterQuery ?? null) : null;

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
      case "SEND_SLACK_MESSAGE": {
        // #6244: see `slackDestinationPresentation` — shared with the list
        // page's "Notifies" cell so the decision can't drift between them.
        const destination = slackDestinationPresentation(actionParams);
        if (destination.kind === "bot") {
          return destination.channelId ? (
            <Text textStyle="sm">
              Slack app · channel {destination.channelId}
            </Text>
          ) : (
            <Text textStyle="sm" color="fg.muted">
              Slack app
            </Text>
          );
        }
        return destination.tooltipUrl ? (
          <Tooltip content={destination.tooltipUrl}>
            <Text
              textStyle="sm"
              lineClamp={1}
              width="fit-content"
              cursor="help"
            >
              Slack webhook
            </Text>
          </Tooltip>
        ) : (
          <Text textStyle="sm">Slack webhook</Text>
        );
      }
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
        ? (resolveSeriesLabel(
            graphQuery.data?.graph,
            actionParams.seriesName,
          ) ?? actionParams.seriesName)
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
                  (isGraphAlert
                    ? "Alert"
                    : isSchedule
                      ? "Schedule"
                      : "Automation")}
              </Heading>
            )}
            <HStack gap={2}>
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
              {/* Paused is the first thing that explains a silent automation,
                  so it sits with the identity rather than only in the answer
                  further down. `tabIndex` is what makes the tooltip
                  reachable: Badge renders a plain span, and a span with no tab
                  stop can be hovered but never focused. */}
              {trigger && !trigger.active ? (
                isAutomationPauseReason(trigger.pausedReason) ? (
                  <Tooltip content={RUNAWAY_PAUSE_EXPLANATION}>
                    <Badge colorPalette="red" tabIndex={0}>
                      Paused
                    </Badge>
                  </Tooltip>
                ) : (
                  <Badge colorPalette="red">Paused</Badge>
                )
              ) : null}
            </HStack>
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

            {trigger ? (
              <NextFiringSection
                automationId={automationId}
                projectId={project?.id ?? ""}
              />
            ) : null}

            {traceQuery ? (
              <MatchingTracesSection
                projectId={project?.id ?? ""}
                query={traceQuery}
              />
            ) : null}

            {trigger ? (
              <HistorySection
                automationId={automationId}
                projectId={project?.id ?? ""}
                isGraphAlert={isGraphAlert}
                canRunConditions={!!traceQuery}
              />
            ) : null}

            {isWebhook ? (
              <WebhookDeliverySection
                automationId={automationId}
                projectId={project?.id ?? ""}
              />
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
