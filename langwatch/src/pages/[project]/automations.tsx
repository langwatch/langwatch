import {
  Box,
  Button,
  Container,
  Heading,
  HStack,
  Spacer,
  Table,
  Text,
  VStack,
} from "@chakra-ui/react";
import type { Monitor, TriggerAction } from "@prisma/client";
import { useMemo } from "react";
import {
  Edit2,
  Eye,
  Filter,
  HelpCircle,
  MoreVertical,
  Plus,
  Trash,
  TrendingUp,
  Zap,
} from "react-feather";
import {
  CADENCE_LABELS,
  CADENCE_WINDOW_MS,
  type NotificationCadence,
} from "~/automations/cadences";
import { CLIENT_PROVIDERS } from "~/automations/providers/client";
import { FilterDisplay } from "~/components/automations/FilterDisplay";
import { HoverableBigText } from "~/components/HoverableBigText";
import { UseCaseStrip } from "~/features/automations/components/page/AutomationsEducation";
import {
  OPERATOR_LABELS,
  TIME_PERIOD_LABELS,
} from "~/features/automations/logic/draftReducer";
import { resolveSeriesLabel } from "~/features/automations/logic/seriesOptions";
import type { TriggerActionParams } from "~/features/automations/logic/triggerActionParams";
import { useDrawer } from "~/hooks/useDrawer";
import SettingsLayout from "../../components/SettingsLayout";
import { Link } from "../../components/ui/link";
import { Menu } from "../../components/ui/menu";
import { Switch } from "../../components/ui/switch";
import { toaster } from "../../components/ui/toaster";
import { Tooltip } from "../../components/ui/tooltip";
import { withPermissionGuard } from "../../components/WithPermissionGuard";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { api, type RouterOutputs } from "../../utils/api";
import { formatTimeAgo } from "../../utils/formatTimeAgo";

type EnhancedTrigger = RouterOutputs["automation"]["getTriggers"][number];
type TriggerStats = RouterOutputs["automation"]["getTriggerStats"][number];

/** Column header with a help tooltip explaining the metric. */
function MetricHeader({ label, help }: { label: string; help: string }) {
  return (
    <HStack gap={1}>
      <Text as="span">{label}</Text>
      <Tooltip content={help}>
        <Box color="fg.muted" display="inline-flex" cursor="help">
          <HelpCircle size={12} />
        </Box>
      </Tooltip>
    </HStack>
  );
}

/**
 * Second line under "Last fired" for automations on a digest schedule:
 * shows when the next bundled send is due (relative to the latest fire),
 * or the schedule itself when nothing recent is pending.
 */
function DigestScheduleHint({
  active,
  cadence,
  lastFiredAt,
}: {
  active: boolean;
  cadence: string;
  lastFiredAt: Date | string | null;
}) {
  const windowMs =
    CADENCE_WINDOW_MS[cadence as NotificationCadence] ?? 0;
  if (!active || windowMs <= 0) return null;

  const dueAt = lastFiredAt
    ? new Date(lastFiredAt).getTime() + windowMs
    : null;
  const now = Date.now();
  const label =
    dueAt && dueAt > now
      ? `Next digest due in ~${Math.max(1, Math.ceil((dueAt - now) / 60_000))}m`
      : `Digest: ${
          CADENCE_LABELS[cadence as NotificationCadence]?.toLowerCase() ??
          cadence
        }`;

  return (
    <Tooltip content="New matches are bundled into one message on this schedule.">
      <Text textStyle="xs" color="fg.muted" cursor="help">
        {label}
      </Text>
    </Tooltip>
  );
}

function LastFiredCell({
  trigger,
  stats,
}: {
  trigger: EnhancedTrigger;
  stats: TriggerStats | undefined;
}) {
  return (
    <VStack align="start" gap={0.5}>
      {stats?.lastFiredAt ? (
        <Text as="span">
          {formatTimeAgo(new Date(stats.lastFiredAt).getTime())}
        </Text>
      ) : (
        <Text as="span" color="fg.muted">
          —
        </Text>
      )}
      <DigestScheduleHint
        active={trigger.active}
        cadence={trigger.notificationCadence}
        lastFiredAt={stats?.lastFiredAt ?? null}
      />
    </VStack>
  );
}

function FiringStatus({ firing }: { firing: boolean }) {
  return firing ? (
    <HStack gap={1.5}>
      <Box width="8px" height="8px" borderRadius="full" bg="red.solid" />
      <Text as="span" textStyle="sm" color="red.fg">
        Firing
      </Text>
    </HStack>
  ) : (
    <Text as="span" textStyle="sm" color="fg.muted">
      OK
    </Text>
  );
}

/** Section header: icon + title + count + one-line inline docs + add CTA. */
function SectionHeader({
  icon,
  title,
  count,
  description,
  addLabel,
  onAdd,
}: {
  icon: React.ReactNode;
  title: string;
  count: number;
  description: string;
  addLabel: string;
  onAdd: () => void;
}) {
  return (
    <HStack width="full" align="start" gap={4}>
      <VStack align="start" gap={1}>
        <HStack gap={2}>
          <Box color="fg.muted">{icon}</Box>
          <Heading size="md">{title}</Heading>
          <Text textStyle="sm" color="fg.muted">
            {count}
          </Text>
        </HStack>
        <Text textStyle="sm" color="fg.muted">
          {description}
        </Text>
      </VStack>
      <Spacer />
      <Button size="sm" variant="outline" onClick={onAdd}>
        <Plus size={14} /> {addLabel}
      </Button>
    </HStack>
  );
}

function Automations() {
  const { project } = useOrganizationTeamProject();
  const { openDrawer } = useDrawer();

  const triggers = api.automation.getTriggers.useQuery(
    {
      projectId: project?.id ?? "",
    },
    {
      enabled: !!project?.id,
    },
  );

  // Fire-history rollup for the metric columns (last fired, 30-day count,
  // open alert incidents). Triggers that never fired have no entry.
  const triggerStats = api.automation.getTriggerStats.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project?.id },
  );
  const statsByTriggerId = useMemo(
    () => new Map((triggerStats.data ?? []).map((s) => [s.triggerId, s])),
    [triggerStats.data],
  );

  // Alerts react to a custom graph's metric; automations react to traces.
  // Distinct shapes, so they get distinct tables.
  const alerts = useMemo(
    () => (triggers.data ?? []).filter((t) => !!t.customGraphId),
    [triggers.data],
  );
  const reports = useMemo(
    () => (triggers.data ?? []).filter((t) => t.triggerKind === "REPORT"),
    [triggers.data],
  );
  const traceAutomations = useMemo(
    () =>
      (triggers.data ?? []).filter(
        (t) => !t.customGraphId && t.triggerKind !== "REPORT",
      ),
    [triggers.data],
  );

  // Only needed to resolve dataset names on ADD_TO_DATASET rows. Gated on
  // the project being loaded (an empty projectId trips the permission
  // middleware with a spurious "no permission" toast) and on the list
  // actually containing a dataset automation.
  const hasDatasetTriggers = (triggers.data ?? []).some(
    (t) => t.action === "ADD_TO_DATASET",
  );
  const getDatasets = api.dataset.getAll.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project?.id && hasDatasetTriggers },
  );

  // Alert rows resolve their stored series key into the series' display
  // name from the graph's JSON. Only fetched when alerts exist; on failure
  // the cell falls back to the raw key.
  const graphsQuery = api.graphs.getAll.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project?.id && alerts.length > 0, retry: false },
  );
  const graphJsonById = useMemo(
    () =>
      new Map<string, unknown>(
        (graphsQuery.data ?? []).map((g) => [g.id, g.graph as unknown]),
      ),
    [graphsQuery.data],
  );

  const toggleTrigger = api.automation.toggleTrigger.useMutation();
  const deleteTriggerMutation = api.automation.deleteById.useMutation();

  const handleToggleTrigger = (triggerId: string, active: boolean) => {
    toggleTrigger.mutate(
      { triggerId, active, projectId: project?.id ?? "" },
      {
        onSuccess: () => {
          void triggers.refetch();
        },
        onError: () => {
          toaster.create({
            title: "Update automation",
            type: "error",
            description: "Failed to update automation",
            meta: {
              closable: true,
            },
          });
        },
      },
    );
  };

  const getDatasetName = (actionParams: TriggerActionParams) => {
    if (actionParams.datasetId) {
      return (
        <Link href={`/${project?.slug}/datasets/${actionParams.datasetId}`}>
          {
            getDatasets.data?.find(
              (dataset) => dataset.id === actionParams.datasetId,
            )?.name
          }
        </Link>
      );
    }
    return "";
  };

  const deleteTrigger = (triggerId: string) => {
    deleteTriggerMutation.mutate(
      { triggerId, projectId: project?.id ?? "" },
      {
        onSuccess: () => {
          toaster.create({
            title: "Delete automation",
            type: "success",
            description: "Automation deleted",
            meta: {
              closable: true,
            },
          });
          void triggers.refetch();
        },
        onError: () => {
          toaster.create({
            title: "Delete automation",
            type: "error",
            description: "Failed to delete automation",
            meta: {
              closable: true,
            },
          });
        },
      },
    );
  };

  // Pull from the provider registry so adding a new TriggerAction doesn't
  // need a parallel switch here.
  const triggerActionName = (action: TriggerAction) =>
    CLIENT_PROVIDERS[action]?.shared.label ?? action;

  const actionItems = (
    action: TriggerAction,
    actionParams: TriggerActionParams,
  ) => {
    switch (action) {
      case "SEND_SLACK_MESSAGE":
        return (
          <Tooltip
            content={(actionParams as { slackWebhook: string }).slackWebhook}
          >
            <Text lineClamp={1} display="block">
              Webhook
            </Text>
          </Tooltip>
        );
      case "SEND_EMAIL":
        return (actionParams as { members: string[] }).members?.join(", ");
      case "ADD_TO_DATASET":
        return getDatasetName(actionParams) ?? "";
    }
  };

  const FilterContainer = ({
    children,
    fontSize = "sm",
  }: {
    children: React.ReactNode;
    fontSize?: string;
  }) => (
    <HStack
      border="1px solid"
      borderColor="border"
      borderRadius="4px"
      fontSize={fontSize}
      width="100%"
      gap={2}
      paddingX={2}
      paddingY={1}
    >
      <Box color="fg.muted">
        <Filter width={16} style={{ minWidth: 16 }} />
      </Box>
      {children}
    </HStack>
  );

  const FilterLabel = ({ children }: { children: React.ReactNode }) => {
    const text = String(children)
      .split(".")
      .filter(
        (word, index) => index !== 0 || word.toLowerCase() === "evaluations",
      )
      .join(" ");

    return (
      <Box
        padding={1}
        fontWeight="500"
        textTransform="capitalize"
        color="fg.muted"
      >
        {text.replace("_", " ")}
      </Box>
    );
  };

  const FilterValue = ({ children }: { children: React.ReactNode }) => {
    return (
      <Box padding={1} borderRightRadius="md">
        <HoverableBigText lineClamp={1} expandable={false}>
          {children}
        </HoverableBigText>
      </Box>
    );
  };

  const applyChecks = (checks: Monitor[]) => {
    if (!checks || checks.length === 0) {
      return null;
    }

    return (
      <FilterContainer fontSize="sm">
        <FilterLabel>Evaluations</FilterLabel>
        <FilterValue>
          {checks.map((check) => check?.name).join(", ")}
        </FilterValue>
      </FilterContainer>
    );
  };

  const rowActionsMenu = (trigger: EnhancedTrigger) => (
    <Menu.Root>
      <Menu.Trigger asChild>
        <Button
          variant={"ghost"}
          aria-label={`Actions for ${trigger.name}`}
          onClick={(event) => {
            event.stopPropagation();
          }}
        >
          <MoreVertical />
        </Button>
      </Menu.Trigger>
      <Menu.Content>
        <Menu.Item
          value="view"
          onClick={(event) => {
            event.stopPropagation();
            openDrawer("viewAutomation", { automationId: trigger.id });
          }}
        >
          <Box display="flex" alignItems="center" gap={2}>
            <Eye size={14} />
            View
          </Box>
        </Menu.Item>
        <Menu.Item
          value="edit"
          onClick={(event) => {
            event.stopPropagation();
            openDrawer("automation", { automationId: trigger.id });
          }}
        >
          <Box display="flex" alignItems="center" gap={2}>
            <Edit2 size={14} />
            Edit
          </Box>
        </Menu.Item>
        <Menu.Item
          value="delete"
          onClick={(event) => {
            event.stopPropagation();
            deleteTrigger(trigger.id);
          }}
        >
          <Box display="flex" alignItems="center" gap={2} color="red.fg">
            <Trash size={14} />
            Delete
          </Box>
        </Menu.Item>
      </Menu.Content>
    </Menu.Root>
  );

  const sharedRowProps = (trigger: EnhancedTrigger) => ({
    key: trigger.id,
    "data-trigger-id": trigger.id,
    cursor: "pointer",
    _hover: { bg: "bg.muted" },
    onClick: () =>
      openDrawer("viewAutomation", { automationId: trigger.id }),
  });

  const activeCell = (trigger: EnhancedTrigger) => (
    <Table.Cell
      textAlign="center"
      onClick={(event) => {
        event.stopPropagation();
      }}
    >
      <Switch
        checked={trigger.active}
        onCheckedChange={({ checked }) => {
          handleToggleTrigger(trigger.id, checked);
        }}
      />
    </Table.Cell>
  );

  const isLoading = triggers.isLoading;

  return (
    <SettingsLayout>
      <Container maxWidth="1280px" padding={4}>
        <VStack align="stretch" gap={8}>
          <VStack align="start" gap={1}>
            <Heading>Alerts &amp; automations</Heading>
            <Text textStyle="sm" color="fg.muted">
              Get notified when a metric crosses a threshold, or act on
              traces as they arrive.
            </Text>
          </VStack>

          {isLoading ? (
            <Text textStyle="sm" color="fg.muted">
              Loading...
            </Text>
          ) : (
            <>
              {/* Alerts: react to a custom graph's metric */}
              <VStack align="stretch" gap={3}>
                <SectionHeader
                  icon={<TrendingUp size={18} />}
                  title="Alerts"
                  count={alerts.length}
                  description="An alert watches a metric on one of your analytics graphs and notifies you when it crosses a threshold, and again when it recovers."
                  addLabel="New alert"
                  onAdd={() =>
                    openDrawer("automation", { initialSource: "customGraph" })
                  }
                />
                {alerts.length === 0 ? (
                  <UseCaseStrip
                    kind="alert"
                    onOpen={(prefill) => openDrawer("automation", prefill)}
                  />
                ) : (
                  <Box
                    border="1px solid"
                    borderColor="border"
                    borderRadius="lg"
                    overflow="hidden"
                  >
                    <Table.Root variant="line" width="full">
                      <Table.Header>
                        <Table.Row>
                          <Table.ColumnHeader>Name</Table.ColumnHeader>
                          <Table.ColumnHeader>Destination</Table.ColumnHeader>
                          <Table.ColumnHeader>Conditions</Table.ColumnHeader>
                          <Table.ColumnHeader whiteSpace="nowrap">
                            <MetricHeader
                              label="Last fired"
                              help="When this alert last crossed its threshold and notified you."
                            />
                          </Table.ColumnHeader>
                          <Table.ColumnHeader whiteSpace="nowrap">
                            <MetricHeader
                              label="Fires (30d)"
                              help="Times this alert fired in the last 30 days."
                            />
                          </Table.ColumnHeader>
                          <Table.ColumnHeader>
                            <MetricHeader
                              label="Status"
                              help="Firing while the metric is past its threshold, back to OK when it recovers."
                            />
                          </Table.ColumnHeader>
                          <Table.ColumnHeader>Active</Table.ColumnHeader>
                          <Table.ColumnHeader>Actions</Table.ColumnHeader>
                        </Table.Row>
                      </Table.Header>
                      <Table.Body>
                        {alerts.map((trigger) => {
                          const actionParams =
                            trigger.actionParams as TriggerActionParams;
                          const stats = statsByTriggerId.get(trigger.id);
                          return (
                            <Table.Row {...sharedRowProps(trigger)}>
                              <Table.Cell>{trigger.name}</Table.Cell>
                              <Table.Cell>
                                {actionItems(trigger.action, actionParams)}
                              </Table.Cell>
                              <Table.Cell maxWidth="500px">
                                <GraphAlertConditions
                                  graphName={trigger.customGraph?.name ?? null}
                                  graph={graphJsonById.get(
                                    trigger.customGraphId ?? "",
                                  )}
                                  actionParams={actionParams}
                                />
                              </Table.Cell>
                              <Table.Cell whiteSpace="nowrap">
                                <LastFiredCell
                                  trigger={trigger}
                                  stats={stats}
                                />
                              </Table.Cell>
                              <Table.Cell>
                                <Text as="span" color="fg.muted">
                                  {stats?.recentFireCount ?? 0}
                                </Text>
                              </Table.Cell>
                              <Table.Cell whiteSpace="nowrap">
                                <FiringStatus
                                  firing={!!stats?.currentlyFiring}
                                />
                              </Table.Cell>
                              {activeCell(trigger)}
                              <Table.Cell>{rowActionsMenu(trigger)}</Table.Cell>
                            </Table.Row>
                          );
                        })}
                      </Table.Body>
                    </Table.Root>
                  </Box>
                )}
              </VStack>

              {/* Reports: send a digest on a schedule */}
              <VStack align="stretch" gap={3}>
                <SectionHeader
                  icon={<CalendarClock size={18} />}
                  title="Reports"
                  count={reports.length}
                  description="A report sends a dashboard, a graph, or a table of traces (e.g. the top errors) on a schedule — a recurring Slack or email digest."
                  addLabel="New report"
                  onAdd={() =>
                    openDrawer("automation", { initialSource: "report" })
                  }
                />
                {reports.length === 0 ? (
                  <Text textStyle="sm" color="fg.muted">
                    No scheduled reports yet. Create one to get a recurring
                    digest in Slack or email — timing is visible in Ops →
                    Scheduler.
                  </Text>
                ) : (
                  <Box
                    border="1px solid"
                    borderColor="border"
                    borderRadius="lg"
                    overflow="hidden"
                  >
                    <Table.Root variant="line" width="full">
                      <Table.Header>
                        <Table.Row>
                          <Table.ColumnHeader>Name</Table.ColumnHeader>
                          <Table.ColumnHeader>Destination</Table.ColumnHeader>
                          <Table.ColumnHeader>Schedule</Table.ColumnHeader>
                        </Table.Row>
                      </Table.Header>
                      <Table.Body>
                        {reports.map((trigger) => (
                          <Table.Row
                            key={trigger.id}
                            cursor="pointer"
                            onClick={() =>
                              openDrawer("automation", {
                                automationId: trigger.id,
                              })
                            }
                          >
                            <Table.Cell>{trigger.name}</Table.Cell>
                            <Table.Cell>
                              {trigger.action === "SEND_SLACK_MESSAGE"
                                ? "Slack"
                                : "Email"}
                            </Table.Cell>
                            <Table.Cell>
                              <Text textStyle="xs" color="fg.muted">
                                On schedule — see Ops → Scheduler
                              </Text>
                            </Table.Cell>
                          </Table.Row>
                        ))}
                      </Table.Body>
                    </Table.Root>
                  </Box>
                )}
              </VStack>

              {/* Automations: react to incoming traces */}
              <VStack align="stretch" gap={3}>
                <SectionHeader
                  icon={<Zap size={18} />}
                  title="Automations"
                  count={traceAutomations.length}
                  description="An automation acts on every incoming trace that matches your filters: send a Slack message or email, add rows to a dataset, or queue traces for annotation."
                  addLabel="New automation"
                  onAdd={() => openDrawer("automation", {})}
                />
                {traceAutomations.length === 0 ? (
                  <UseCaseStrip
                    kind="automation"
                    onOpen={(prefill) => openDrawer("automation", prefill)}
                  />
                ) : (
                  <Box
                    border="1px solid"
                    borderColor="border"
                    borderRadius="lg"
                    overflow="hidden"
                  >
                    <Table.Root variant="line" width="full">
                      <Table.Header>
                        <Table.Row>
                          <Table.ColumnHeader>Name</Table.ColumnHeader>
                          <Table.ColumnHeader>Action</Table.ColumnHeader>
                          <Table.ColumnHeader>Destination</Table.ColumnHeader>
                          <Table.ColumnHeader>Conditions</Table.ColumnHeader>
                          <Table.ColumnHeader whiteSpace="nowrap">
                            <MetricHeader
                              label="Last fired"
                              help="When this automation last matched a trace and ran its action. Automations on a digest schedule also show when the next bundled send is due."
                            />
                          </Table.ColumnHeader>
                          <Table.ColumnHeader whiteSpace="nowrap">
                            <MetricHeader
                              label="Fires (30d)"
                              help="Times this automation fired in the last 30 days."
                            />
                          </Table.ColumnHeader>
                          <Table.ColumnHeader>Active</Table.ColumnHeader>
                          <Table.ColumnHeader>Actions</Table.ColumnHeader>
                        </Table.Row>
                      </Table.Header>
                      <Table.Body>
                        {traceAutomations.map((trigger) => {
                          const actionParams =
                            trigger.actionParams as TriggerActionParams;
                          const stats = statsByTriggerId.get(trigger.id);
                          return (
                            <Table.Row {...sharedRowProps(trigger)}>
                              <Table.Cell>{trigger.name}</Table.Cell>
                              <Table.Cell>
                                {triggerActionName(trigger.action)}
                              </Table.Cell>
                              <Table.Cell>
                                {actionItems(trigger.action, actionParams)}
                              </Table.Cell>
                              <Table.Cell maxWidth="500px">
                                <VStack gap={2}>
                                  {applyChecks(
                                    trigger.checks?.filter(
                                      (check): check is Monitor => !!check,
                                    ) ?? [],
                                  )}

                                  {trigger.filters &&
                                  typeof trigger.filters === "string" ? (
                                    <FilterDisplay
                                      filters={trigger.filters}
                                      hasBorder={true}
                                    />
                                  ) : null}
                                </VStack>
                              </Table.Cell>
                              <Table.Cell whiteSpace="nowrap">
                                <LastFiredCell
                                  trigger={trigger}
                                  stats={stats}
                                />
                              </Table.Cell>
                              <Table.Cell>
                                <Text as="span" color="fg.muted">
                                  {stats?.recentFireCount ?? 0}
                                </Text>
                              </Table.Cell>
                              {activeCell(trigger)}
                              <Table.Cell>{rowActionsMenu(trigger)}</Table.Cell>
                            </Table.Row>
                          );
                        })}
                      </Table.Body>
                    </Table.Root>
                  </Box>
                )}
              </VStack>
            </>
          )}
        </VStack>
      </Container>
    </SettingsLayout>
  );
}

interface GraphAlertConditionsProps {
  graphName: string | null;
  /** The joined custom graph's JSON, used to resolve the stored series key
   *  into its display name. Undefined when the graph was deleted. */
  graph?: unknown;
  actionParams: TriggerActionParams;
}

/**
 * Compact rendering of an alert row's conditions cell: shows the graph it
 * watches plus the threshold rule that fires it. Mirrors the dashboard
 * "Configure Alert" copy verbatim (`greater than`, `over 5 minutes`) so the
 * experience reads the same across both creation paths.
 */
function GraphAlertConditions({
  graphName,
  graph,
  actionParams,
}: GraphAlertConditionsProps) {
  const operator = actionParams.operator
    ? OPERATOR_LABELS[actionParams.operator]
    : null;
  const window = actionParams.timePeriod
    ? TIME_PERIOD_LABELS[actionParams.timePeriod]
    : null;
  const seriesLabel = actionParams.seriesName
    ? (resolveSeriesLabel(graph, actionParams.seriesName) ??
      actionParams.seriesName)
    : null;
  return (
    <VStack align="start" gap={1}>
      {graphName ? (
        <Text textStyle="sm" fontWeight="medium">
          Graph: {graphName}
        </Text>
      ) : (
        <Text textStyle="sm" color="fg.muted">
          Graph deleted
        </Text>
      )}
      {seriesLabel ? (
        <Text textStyle="sm" color="fg.muted">
          {seriesLabel}
          {operator ? ` ${operator}` : ""}
          {actionParams.threshold !== undefined
            ? ` ${actionParams.threshold}`
            : ""}
          {window ? ` over ${window}` : ""}
        </Text>
      ) : null}
    </VStack>
  );
}

export default withPermissionGuard("triggers:view", {
  layoutComponent: SettingsLayout,
})(Automations);
