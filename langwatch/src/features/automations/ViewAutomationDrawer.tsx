import {
  Badge,
  Box,
  Button,
  HStack,
  Heading,
  Skeleton,
  Spacer,
  Text,
  VStack,
} from "@chakra-ui/react";
import { differenceInMinutes, differenceInSeconds } from "date-fns";
import { TrendingUp } from "react-feather";
import { CLIENT_PROVIDERS } from "~/automations/providers/client";
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
import { api } from "~/utils/api";
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

  const trigger = triggerQuery.data;
  const isGraphAlert = !!trigger?.customGraphId;
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
    if (trigger.filters && typeof trigger.filters === "string") {
      return <FilterDisplay filters={trigger.filters} hasBorder={true} />;
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
                {trigger?.name ?? (isGraphAlert ? "Alert" : "Automation")}
              </Heading>
            )}
            {isGraphAlert ? (
              <Badge colorPalette="purple" gap={1}>
                <TrendingUp size={12} />
                Alert
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
                <VStack align="stretch" gap={0} width="full">
                  {recentFiresQuery.data?.map((fire) => {
                    const firedAt = new Date(fire.createdAt);
                    const isOpenIncident =
                      !!fire.customGraphId && !fire.resolvedAt;
                    return (
                      <HStack
                        key={fire.id}
                        justify="space-between"
                        paddingY={2}
                        borderBottomWidth="1px"
                        borderColor="border"
                        _last={{ borderBottomWidth: 0 }}
                      >
                        <Text textStyle="sm">
                          fired {formatTimeAgo(firedAt.getTime())}
                          {fire.resolvedAt
                            ? ` · resolved after ${formatDurationBetween(
                                firedAt,
                                new Date(fire.resolvedAt),
                              )}`
                            : ""}
                        </Text>
                        {isOpenIncident ? (
                          <HStack gap={1.5}>
                            <Box
                              width="8px"
                              height="8px"
                              borderRadius="full"
                              bg="red.solid"
                            />
                            <Text textStyle="sm" color="red.fg">
                              Still firing
                            </Text>
                          </HStack>
                        ) : null}
                      </HStack>
                    );
                  })}
                </VStack>
              )}
            </VStack>
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
