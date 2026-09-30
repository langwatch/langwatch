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
import {
  isAutomationPauseReason,
  parseAutomationFiltersWire,
  RUNAWAY_PAUSE_EXPLANATION,
} from "@langwatch/automation-contract";
import { Drawer } from "@langwatch/design-system/drawer";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { type NamedSlackConnection } from "@langwatch/slack-browser-kit";
import { Calendar, TrendingUp } from "react-feather";

import type { RouterOutputs } from "../../../../behavior/automation-api.ts";
import { api } from "../../../../behavior/automation-api.ts";
import {
  useCloseAddressedDrawer,
  useOrganizationTeamProject,
} from "../../../../behavior/automation-session.ts";
import { slackApi } from "../../../../behavior/slack-api.ts";
import { useAutomationHost } from "../../../../model/automation-host.ts";
import { resolveSeriesLabel } from "../../../../model/graph-series.ts";
import { FilterDisplay } from "../../../../ui/elements/filter-display.tsx";
import { EmailList, type TriggerActionParams } from "../../../overview/index.ts";
import {
  slackDestinationLabel,
  slackDestinationPresentation,
} from "../../../overview/model/slack-destination-presentation.ts";
import { matchesEveryTrace } from "../../model/matches-every-trace.ts";
import { MatchesEveryTraceNotice } from "../elements/matches-every-trace-notice.tsx";
import { CLIENT_PROVIDERS } from "./client-providers.ts";
import { OPERATOR_LABELS, TIME_PERIOD_LABELS } from "./draft-model.ts";
import { HistorySection } from "./history-section.tsx";
import { MatchingTracesSection } from "./matching-traces-section.tsx";
import { NextFiringSection } from "./next-firing-section.tsx";
import { UnavailableAutomationDrawer } from "./unavailable-automation-drawer.tsx";
import { WebhookDeliverySection } from "./webhook-delivery-section.tsx";

interface ViewAutomationDrawerProps {
  automationId: string;
  /**
   * Closes the panel. Taken as a prop (drawers doc rule): a target that
   * calls `closeDrawer` itself clears the caller's stack too. The
   * registry adapter supplies the navigator's own close.
   */
  onClose: () => void;
  /** Hands over to the editor, which the registry answers to as `automation`. */
  onEdit: (automationId: string) => void;
}

/** The panel as the registry opens it at `?drawer.open=viewAutomation`; the host closes it. */
export function RegisteredViewAutomationDrawer({ automationId }: { automationId: string }) {
  const host = useAutomationHost();
  const close = useCloseAddressedDrawer();
  return (
    <ViewAutomationDrawer
      automationId={automationId}
      onClose={close}
      onEdit={(id) => host.openDrawer({ drawer: "automation", params: { automationId: id } })}
    />
  );
}

export function ViewAutomationDrawer({ automationId, onClose, onEdit }: ViewAutomationDrawerProps) {
  const { project } = useOrganizationTeamProject();
  const projectId = project?.id ?? "";

  const triggerQuery = api.automation.getTriggerById.useQuery(
    { triggerId: automationId, projectId },
    { enabled: !!projectId },
  );
  const trigger = triggerQuery.data ?? undefined;
  const isGraphAlert = !!trigger?.customGraphId;
  const isWebhook = trigger?.action === "SEND_WEBHOOK";
  const isSchedule = trigger?.triggerKind === "REPORT";
  const actionParams = (trigger?.actionParams ?? {}) as TriggerActionParams;
  // Conditions can only be re-run when the subject IS a trace query (ADR-043):
  // a graph alert watches a metric, and a legacy `filters` row has no query.
  const traceQuery = isGraphAlert ? "" : (trigger?.filterQuery ?? "");
  const isUnconditioned =
    !!trigger &&
    !isGraphAlert &&
    !isSchedule &&
    matchesEveryTrace({ filterQuery: trigger.filterQuery, filters: trigger.filters });

  // The watched graph names the stored series key; the dataset list names the
  // ADD_TO_DATASET destination; the Slack connections name a Slack one.
  const graphQuery = api.graphs.getById.useQuery(
    { projectId, id: trigger?.customGraphId ?? "" },
    { enabled: !!projectId && !!trigger?.customGraphId, retry: false },
  );
  const datasetsQuery = api.dataset.getAll.useQuery(
    { projectId },
    { enabled: !!projectId && trigger?.action === "ADD_TO_DATASET" },
  );
  const slackConnectionsQuery = slackApi.slackIntegration.list.useQuery(
    { projectId },
    { enabled: !!projectId && trigger?.action === "SEND_SLACK_MESSAGE" },
  );
  const datasetName = actionParams.datasetId
    ? (datasetsQuery.data?.find((d) => d.id === actionParams.datasetId)?.name ?? null)
    : null;

  // `null` is the server's settled "no such automation"; pending is undefined.
  if (triggerQuery.error || triggerQuery.data === null) {
    return <UnavailableAutomationDrawer error={triggerQuery.error} onClose={onClose} />;
  }

  return (
    <Drawer.Root
      open={true}
      placement="end"
      size="md"
      onOpenChange={({ open }) => {
        if (!open) onClose();
      }}
    >
      <Drawer.Content bg="bg">
        <Drawer.Header>
          <Drawer.CloseTrigger />
          <VStack align="start" gap={1}>
            {triggerQuery.isLoading ? (
              <Skeleton height="24px" width="200px" />
            ) : (
              <Heading size="md">{trigger?.name ?? (isSchedule ? "Report" : "Automation")}</Heading>
            )}
            <HStack gap={2}>
              {kindBadgeOf({ trigger, isGraphAlert, isSchedule })}
              {pausedBadgeOf({ trigger })}
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
                  ? (CLIENT_PROVIDERS[trigger.action]?.shared.label ?? trigger.action)
                  : null}
              </Text>
            </VStack>

            <VStack align="start" gap={1}>
              <Text textStyle="xs" color="fg.muted" fontWeight="medium">
                Destination
              </Text>
              {destinationSummaryOf({
                trigger,
                actionParams,
                datasetName,
                slackConnections: slackConnectionsQuery.data?.connections,
              }) ?? <Text textStyle="sm">None</Text>}
            </VStack>

            <VStack align="start" gap={1} width="full">
              <Text textStyle="xs" color="fg.muted" fontWeight="medium">
                Conditions
              </Text>
              {conditionsSummaryOf({
                trigger,
                isGraphAlert,
                isUnconditioned,
                actionParams,
                graph: graphQuery.data?.graph,
              })}
            </VStack>

            {trigger ? (
              <NextFiringSection automationId={automationId} projectId={projectId} />
            ) : null}

            {traceQuery ? <MatchingTracesSection projectId={projectId} query={traceQuery} /> : null}

            {trigger ? (
              <HistorySection
                automationId={automationId}
                projectId={projectId}
                isGraphAlert={isGraphAlert}
                canRunConditions={!!traceQuery}
                isUnconditioned={isUnconditioned}
                isReport={isSchedule}
              />
            ) : null}

            {isWebhook ? (
              <WebhookDeliverySection automationId={automationId} projectId={projectId} />
            ) : null}
          </VStack>
        </Drawer.Body>
        <Drawer.Footer>
          <HStack width="full">
            <Spacer />
            <Button colorPalette="orange" onClick={() => onEdit(automationId)}>
              Edit
            </Button>
          </HStack>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer.Root>
  );
}

type ViewedTrigger = NonNullable<RouterOutputs["automation"]["getTriggerById"]>;

/** Where the automation delivers, with any secret in it masked. */
function destinationSummaryOf({
  trigger,
  actionParams,
  datasetName,
  slackConnections,
}: {
  trigger: ViewedTrigger | undefined;
  actionParams: TriggerActionParams;
  datasetName: string | null;
  slackConnections: readonly NamedSlackConnection[] | undefined;
}): React.ReactNode {
  if (!trigger) return null;
  switch (trigger.action) {
    case "SEND_SLACK_MESSAGE":
      return <SlackDestination actionParams={actionParams} connections={slackConnections} />;
    case "SEND_EMAIL":
      return actionParams.members?.length ? (
        <Text textStyle="sm" overflowWrap="anywhere">
          <EmailList emails={actionParams.members} />
        </Text>
      ) : null;
    case "SEND_WEBHOOK": {
      let hostname = "Webhook";
      try {
        hostname = actionParams.url ? new URL(actionParams.url).hostname : hostname;
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
}

/** The Slack connection (and channel); a webhook URL only on hover (#6244, as the list). */
function SlackDestination({
  actionParams,
  connections,
}: {
  actionParams: TriggerActionParams;
  connections: readonly NamedSlackConnection[] | undefined;
}) {
  const destination = slackDestinationPresentation({ actionParams, connections });
  const label = slackDestinationLabel(destination);
  if (destination.kind === "webhook" && destination.tooltipUrl) {
    return (
      <Tooltip content={destination.tooltipUrl}>
        <Text textStyle="sm" lineClamp={1} width="fit-content" cursor="help">
          {label}
        </Text>
      </Tooltip>
    );
  }
  return <Text textStyle="sm">{label}</Text>;
}

/** What the automation watches: a graph threshold, a search query, or trace filters. */
function conditionsSummaryOf({
  trigger,
  isGraphAlert,
  isUnconditioned,
  actionParams,
  graph,
}: {
  trigger: ViewedTrigger | undefined;
  isGraphAlert: boolean;
  isUnconditioned: boolean;
  actionParams: TriggerActionParams;
  graph: unknown;
}): React.ReactNode {
  if (!trigger) return null;
  if (isGraphAlert) {
    const operator = actionParams.operator ? OPERATOR_LABELS[actionParams.operator] : null;
    const window = actionParams.timePeriod ? TIME_PERIOD_LABELS[actionParams.timePeriod] : null;
    const seriesLabel = actionParams.seriesName
      ? (resolveSeriesLabel(graph, actionParams.seriesName) ?? actionParams.seriesName)
      : "Metric";
    return (
      <Text textStyle="sm">
        {seriesLabel}
        {operator ? ` ${operator}` : ""}
        {actionParams.threshold !== undefined ? ` ${actionParams.threshold}` : ""}
        {window ? ` over ${window}` : ""}
      </Text>
    );
  }
  if (trigger.filterQuery) {
    // ADR-043: a trace-subject automation shows its search query, as the list's cell does.
    return (
      <Code size="sm" variant="surface" whiteSpace="pre-wrap" wordBreak="break-word">
        {trigger.filterQuery}
      </Code>
    );
  }
  const filters = parseAutomationFiltersWire(trigger.filters);
  if (Object.keys(filters).length > 0) {
    return (
      <FilterDisplay filters={JSON.stringify(filters)} hasBorder={true} shouldClampValues={false} />
    );
  }
  if (isUnconditioned) return <MatchesEveryTraceNotice />;
  return (
    <Text textStyle="sm" color="fg.muted">
      No conditions
    </Text>
  );
}

/** What the row IS: after the merge two answers, not three (ADR-093 §1). */
function kindBadgeOf({
  trigger,
  isGraphAlert,
  isSchedule,
}: {
  trigger: ViewedTrigger | undefined;
  isGraphAlert: boolean;
  isSchedule: boolean;
}): React.ReactNode {
  if (isSchedule) {
    return (
      <Badge colorPalette="purple" gap={1}>
        <Calendar size={12} />
        Report
      </Badge>
    );
  }
  if (isGraphAlert) {
    return (
      <Badge colorPalette="purple" gap={1}>
        <TrendingUp size={12} />
        Watches a graph
      </Badge>
    );
  }
  if (trigger) return <Badge colorPalette="gray">Watches a trace filter</Badge>;
  return null;
}

/** Paused explains a silent automation first; `tabIndex` makes the runaway tooltip reachable. */
function pausedBadgeOf({ trigger }: { trigger: ViewedTrigger | undefined }): React.ReactNode {
  if (!trigger || trigger.active) return null;
  if (!isAutomationPauseReason(trigger.pausedReason)) {
    return <Badge colorPalette="red">Paused</Badge>;
  }
  return (
    <Tooltip content={RUNAWAY_PAUSE_EXPLANATION}>
      <Badge colorPalette="red" tabIndex={0}>
        Paused
      </Badge>
    </Tooltip>
  );
}
