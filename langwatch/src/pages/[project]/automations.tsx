import {
  Box,
  Button,
  Code,
  HStack,
  SimpleGrid,
  Table,
  Text,
  VStack,
} from "@chakra-ui/react";
import type { Monitor, TriggerAction } from "@prisma/client";
import { useMemo } from "react";
import {
  Calendar,
  Edit2,
  Eye,
  Filter,
  MoreVertical,
  Trash,
  TrendingUp,
  Zap,
} from "react-feather";
import { FilterDisplay } from "~/components/automations/FilterDisplay";
import { DashboardLayout } from "~/components/DashboardLayout";
import { HoverableBigText } from "~/components/HoverableBigText";
import { PageLayout } from "~/components/ui/layouts/PageLayout";
import { SectionNavigationLayout } from "~/components/ui/layouts/SectionNavigationLayout";
import { Link } from "~/components/ui/link";
import { Menu } from "~/components/ui/menu";
import { Switch } from "~/components/ui/switch";
import { toaster } from "~/components/ui/toaster";
import { Tooltip } from "~/components/ui/tooltip";
import { withPermissionGuard } from "~/components/WithPermissionGuard";
import { UseCaseStrip } from "~/features/automations/components/page/AutomationsEducation";
import { AutomationsHistory } from "~/features/automations/components/page/AutomationsHistory";
import {
  AlertRuleCell,
  AlertSubjectCell,
  describeSchedule,
  EmptyHint,
  FiringStatus,
  LastFiredCell,
  MetricHeader,
  ReportRunCells,
  ReportSubjectCell,
  SectionHeader,
  TableShell,
} from "~/features/automations/components/page/AutomationTableCells";
import type { TriggerActionParams } from "~/features/automations/logic/triggerActionParams";
import { LangyContextTarget } from "~/features/langy/components/LangyContextTarget";
import { automationContextChip } from "~/features/langy/logic/langyContextChips";
import { CLIENT_PROVIDERS } from "~/features/automations/providers/registry";
import { useDrawer } from "~/hooks/useDrawer";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api, type RouterOutputs } from "~/utils/api";
import { useRouter } from "~/utils/compat/next-router";
import { formatTimeAgo } from "~/utils/formatTimeAgo";

type EnhancedTrigger = RouterOutputs["automation"]["getTriggers"][number];

type AutomationSection = "overview" | "automations" | "alerts" | "schedules";

const sectionDetails: Record<
  AutomationSection,
  { title: string; description: string }
> = {
  overview: {
    title: "Overview",
    description:
      "See what is firing, what is scheduled next, and recent automation activity.",
  },
  automations: {
    title: "Automations",
    description: "Act on every incoming trace that matches your filters.",
  },
  alerts: {
    title: "Alerts",
    description:
      "Get told when a metric crosses a threshold and when it recovers.",
  },
  schedules: {
    title: "Schedules",
    description:
      "Send a dashboard, graph, or trace table on a recurring cadence.",
  },
};

const sectionFromPath = (pathname: string): AutomationSection => {
  if (pathname.includes("/automations/automations")) return "automations";
  if (pathname.includes("/automations/alerts")) return "alerts";
  if (pathname.includes("/automations/schedules")) return "schedules";
  return "overview";
};

function AutomationsPage() {
  const { project } = useOrganizationTeamProject();
  const { openDrawer } = useDrawer();
  const router = useRouter();
  const section = sectionFromPath(router.pathname);
  const details = sectionDetails[section];
  const basePath = project ? `/${project.slug}/automations` : "/auth/signin";

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

  // A report's cron only DESCRIBES its schedule; the scheduler owns the real
  // instants, so next/last run come from there, not from the trigger row.
  const reportSchedules = api.automation.getReportSchedules.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project?.id },
  );
  const scheduleByTriggerId = useMemo(
    () => new Map((reportSchedules.data ?? []).map((s) => [s.triggerId, s])),
    [reportSchedules.data],
  );

  // What every automation in the project has actually been doing. Now surfaced
  // inline (no History tab), so it loads with the page.
  const activity = api.automation.getRecentActivity.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project?.id },
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

  const reportsUseGraph = useMemo(
    () =>
      reports.some(
        (r) =>
          (r.actionParams as { source?: { kind?: string } } | null)?.source
            ?.kind === "customGraph",
      ),
    [reports],
  );

  // Alert rows resolve their stored series key into the series' display name
  // from the graph's JSON; report rows that send a custom graph also need the
  // graph's name. Only fetched when either is present; on failure the cell
  // falls back to the raw key / a generic label.
  const graphsQuery = api.graphs.getAll.useQuery(
    { projectId: project?.id ?? "" },
    {
      enabled: !!project?.id && (alerts.length > 0 || reportsUseGraph),
      retry: false,
    },
  );
  const graphJsonById = useMemo(
    () =>
      new Map<string, unknown>(
        (graphsQuery.data ?? []).map((g) => [g.id, g.graph as unknown]),
      ),
    [graphsQuery.data],
  );
  const graphNameById = useMemo(
    () =>
      new Map<string, string>(
        (graphsQuery.data ?? []).map((g) => [
          g.id,
          (g as { name?: string }).name ?? "graph",
        ]),
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

  // No `key` here: the row is wrapped by <LangyContextTarget>, and the key
  // belongs on the outermost element of the iteration, not on the row inside it.
  const sharedRowProps = (trigger: EnhancedTrigger) => ({
    "data-trigger-id": trigger.id,
    cursor: "pointer",
    _hover: { bg: "bg.muted" },
    onClick: () => openDrawer("viewAutomation", { automationId: trigger.id }),
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

  const overview = useMemo(() => {
    const stats = [...statsByTriggerId.values()];
    const firingNow = stats.filter((stat) => stat.currentlyFiring).length;
    const fired30d = stats.reduce(
      (sum, stat) => sum + (stat.recentFireCount ?? 0),
      0,
    );
    const next = (reportSchedules.data ?? [])
      .filter((schedule) => schedule.nextRunAt)
      .map((schedule) => ({
        at: new Date(schedule.nextRunAt!).getTime(),
        triggerId: schedule.triggerId,
      }))
      .sort((left, right) => left.at - right.at)[0];
    const nextName = next
      ? ((triggers.data ?? []).find((trigger) => trigger.id === next.triggerId)
          ?.name ?? null)
      : null;

    return { firingNow, fired30d, next, nextName };
  }, [reportSchedules.data, statsByTriggerId, triggers.data]);

  return (
    <SectionNavigationLayout
      sectionLabel="Automations"
      navigationItems={[
        {
          label: "Overview",
          href: basePath,
          icon: <Eye size={14} />,
        },
        {
          label: "Automations",
          href: `${basePath}/automations`,
          icon: <Zap size={14} />,
        },
        {
          label: "Alerts",
          href: `${basePath}/alerts`,
          icon: <TrendingUp size={14} />,
        },
        {
          label: "Schedules",
          href: `${basePath}/schedules`,
          icon: <Calendar size={14} />,
        },
      ]}
    >
      <PageLayout.Header>
        <PageLayout.Heading>{details.title}</PageLayout.Heading>
      </PageLayout.Header>
      <Box padding={6} width="full">
        <VStack align="stretch" gap={6} width="full">
          <Text textStyle="sm" color="fg.muted">
            {details.description}
          </Text>

          {isLoading ? (
            <Text textStyle="sm" color="fg.muted">
              Loading...
            </Text>
          ) : (
            <>
              {section === "alerts" && (
                <VStack align="stretch" gap={4}>
                  <SectionHeader
                    icon={<TrendingUp size={18} />}
                    accent="orange"
                    title="Alerts"
                    count={alerts.length}
                    summary="Get told when a metric crosses a threshold, and again when it recovers."
                    details="An alert watches one series on an analytics graph. When the value crosses your threshold it notifies your channel; when it returns to normal it sends a recovery notice."
                    addLabel="New alert"
                    onAdd={() =>
                      openDrawer("automation", {
                        initialSource: "customGraph",
                      })
                    }
                  />
                  {alerts.length === 0 ? (
                    <UseCaseStrip
                      kind="alert"
                      onOpen={(prefill) => openDrawer("automation", prefill)}
                    />
                  ) : (
                    <TableShell>
                      <Table.Root variant="line" width="full">
                        <Table.Header>
                          <Table.Row>
                            <Table.ColumnHeader>Name</Table.ColumnHeader>
                            <Table.ColumnHeader>Watches</Table.ColumnHeader>
                            <Table.ColumnHeader whiteSpace="nowrap">
                              Fires when
                            </Table.ColumnHeader>
                            <Table.ColumnHeader>Notifies</Table.ColumnHeader>
                            <Table.ColumnHeader whiteSpace="nowrap">
                              <MetricHeader
                                label="Last fired"
                                help="When this alert last crossed its threshold and notified you."
                              />
                            </Table.ColumnHeader>
                            <Table.ColumnHeader whiteSpace="nowrap">
                              <MetricHeader
                                label="Status"
                                help="Firing while the metric is past its threshold, back to OK when it recovers."
                              />
                            </Table.ColumnHeader>
                            <Table.ColumnHeader>Active</Table.ColumnHeader>
                            <Table.ColumnHeader />
                          </Table.Row>
                        </Table.Header>
                        <Table.Body>
                          {alerts.map((trigger) => {
                            const actionParams =
                              trigger.actionParams as TriggerActionParams;
                            const stats = statsByTriggerId.get(trigger.id);
                            return (
                              // Armed, the row can be handed to Langy; its own click (open the
                              // automation) is untouched. The chip id matches the one the
                              // `/automations/<id>` route derives, so the row and the open
                              // automation are one chip.
                              <LangyContextTarget
                                key={trigger.id}
                                target={automationContextChip({
                                  automationId: trigger.id,
                                  name: trigger.name,
                                })}
                              >
                              <Table.Row {...sharedRowProps(trigger)}>
                                <Table.Cell fontWeight="medium">
                                  {trigger.name}
                                </Table.Cell>
                                <Table.Cell maxWidth="260px">
                                  <AlertSubjectCell
                                    graphName={
                                      trigger.customGraph?.name ?? null
                                    }
                                    graph={graphJsonById.get(
                                      trigger.customGraphId ?? "",
                                    )}
                                    seriesName={actionParams.seriesName}
                                  />
                                </Table.Cell>
                                <Table.Cell whiteSpace="nowrap">
                                  <AlertRuleCell actionParams={actionParams} />
                                </Table.Cell>
                                <Table.Cell>
                                  {actionItems(trigger.action, actionParams)}
                                </Table.Cell>
                                <Table.Cell whiteSpace="nowrap">
                                  <LastFiredCell
                                    trigger={trigger}
                                    stats={stats}
                                  />
                                </Table.Cell>
                                <Table.Cell whiteSpace="nowrap">
                                  <FiringStatus
                                    firing={!!stats?.currentlyFiring}
                                  />
                                </Table.Cell>
                                {activeCell(trigger)}
                                <Table.Cell>
                                  {rowActionsMenu(trigger)}
                                </Table.Cell>
                              </Table.Row>
                              </LangyContextTarget>
                            );
                          })}
                        </Table.Body>
                      </Table.Root>
                    </TableShell>
                  )}
                </VStack>
              )}

              {section === "overview" && (
                <VStack align="stretch" gap={8} width="full">
                  <SimpleGrid columns={{ base: 1, md: 3 }} gap={4}>
                    <StatTile
                      label="Firing now"
                      value={overview.firingNow}
                      sub={
                        overview.firingNow > 0
                          ? "alerts over their threshold"
                          : "all clear"
                      }
                      alert={overview.firingNow > 0}
                    />
                    <StatTile
                      label="Fired (30 days)"
                      value={overview.fired30d.toLocaleString()}
                      sub="across every automation"
                    />
                    <StatTile
                      label="Next scheduled"
                      value={
                        overview.next
                          ? (formatTimeAgo(overview.next.at) ?? "—")
                          : "—"
                      }
                      sub={overview.nextName ?? "no schedules queued"}
                    />
                  </SimpleGrid>

                  <VStack align="stretch" gap={3} width="full">
                    <OverviewSectionHeading
                      title="Recent activity"
                      summary="See what alerts, schedules, and automations have done recently."
                    />
                    <AutomationsHistory
                      fires={activity.data ?? []}
                      triggers={triggers.data ?? []}
                      isLoading={activity.isLoading}
                      onOpenAutomation={(triggerId) =>
                        openDrawer("viewAutomation", {
                          automationId: triggerId,
                        })
                      }
                    />
                  </VStack>

                  <VStack align="stretch" gap={4} width="full">
                    <OverviewSectionHeading
                      title="Popular uses"
                      summary="Start from a common workflow and tailor it to your project."
                    />
                    <VStack align="stretch" gap={2}>
                      <Text
                        textStyle="xs"
                        fontWeight="semibold"
                        color="fg.muted"
                      >
                        Alerts
                      </Text>
                      <UseCaseStrip
                        kind="alert"
                        showLabel={false}
                        onOpen={(prefill) => openDrawer("automation", prefill)}
                      />
                    </VStack>
                    <VStack align="stretch" gap={2}>
                      <Text
                        textStyle="xs"
                        fontWeight="semibold"
                        color="fg.muted"
                      >
                        Automations
                      </Text>
                      <UseCaseStrip
                        kind="automation"
                        showLabel={false}
                        onOpen={(prefill) => openDrawer("automation", prefill)}
                      />
                    </VStack>
                  </VStack>
                </VStack>
              )}

              {section === "schedules" && (
                <VStack align="stretch" gap={4}>
                  <SectionHeader
                    icon={<Calendar size={18} />}
                    accent="purple"
                    title="Schedules"
                    count={reports.length}
                    summary="Send a dashboard, a graph, or a table of traces on a recurring schedule."
                    details="A schedule bundles a dashboard, a single graph, or a top-N trace table into a Slack or email digest on the schedule you set."
                    addLabel="New schedule"
                    onAdd={() =>
                      openDrawer("automation", { initialSource: "report" })
                    }
                  />
                  {reports.length === 0 ? (
                    <EmptyHint>
                      No schedules yet. Create one for a recurring Slack or
                      email digest.
                    </EmptyHint>
                  ) : (
                    <TableShell>
                      <Table.Root variant="line" width="full">
                        <Table.Header>
                          <Table.Row>
                            <Table.ColumnHeader>Name</Table.ColumnHeader>
                            <Table.ColumnHeader>Sends</Table.ColumnHeader>
                            <Table.ColumnHeader whiteSpace="nowrap">
                              Schedule
                            </Table.ColumnHeader>
                            <Table.ColumnHeader whiteSpace="nowrap">
                              <MetricHeader
                                label="Next run"
                                help="When this next goes out, straight from the scheduler. A paused schedule has no next run."
                              />
                            </Table.ColumnHeader>
                            <Table.ColumnHeader whiteSpace="nowrap">
                              <MetricHeader
                                label="Last run"
                                help="The last time this was sent."
                              />
                            </Table.ColumnHeader>
                            <Table.ColumnHeader>Delivery</Table.ColumnHeader>
                            <Table.ColumnHeader>Active</Table.ColumnHeader>
                            <Table.ColumnHeader />
                          </Table.Row>
                        </Table.Header>
                        <Table.Body>
                          {reports.map((trigger) => {
                            const actionParams =
                              trigger.actionParams as TriggerActionParams;
                            const schedule = (
                              actionParams as {
                                schedule?: {
                                  cron?: string;
                                  timezone?: string;
                                };
                              }
                            ).schedule;
                            return (
                              // Armed, the row can be handed to Langy; its own click (open the
                              // automation) is untouched. The chip id matches the one the
                              // `/automations/<id>` route derives, so the row and the open
                              // automation are one chip.
                              <LangyContextTarget
                                key={trigger.id}
                                target={automationContextChip({
                                  automationId: trigger.id,
                                  name: trigger.name,
                                })}
                              >
                              <Table.Row
                                data-trigger-id={trigger.id}
                                cursor="pointer"
                                _hover={{ bg: "bg.muted" }}
                                onClick={() =>
                                  openDrawer("automation", {
                                    automationId: trigger.id,
                                  })
                                }
                              >
                                <Table.Cell fontWeight="medium">
                                  {trigger.name}
                                </Table.Cell>
                                <Table.Cell>
                                  <ReportSubjectCell
                                    actionParams={actionParams}
                                    graphNameById={graphNameById}
                                  />
                                </Table.Cell>
                                <Table.Cell whiteSpace="nowrap">
                                  <Text textStyle="sm">
                                    {schedule?.cron
                                      ? describeSchedule(
                                          schedule.cron,
                                          schedule.timezone ?? "UTC",
                                        )
                                      : "Not set"}
                                  </Text>
                                </Table.Cell>
                                <ReportRunCells
                                  schedule={scheduleByTriggerId.get(trigger.id)}
                                  loading={reportSchedules.isLoading}
                                />
                                <Table.Cell>
                                  {trigger.action === "SEND_SLACK_MESSAGE"
                                    ? "Slack"
                                    : "Email"}
                                </Table.Cell>
                                {activeCell(trigger)}
                                <Table.Cell>
                                  {rowActionsMenu(trigger)}
                                </Table.Cell>
                              </Table.Row>
                              </LangyContextTarget>
                            );
                          })}
                        </Table.Body>
                      </Table.Root>
                    </TableShell>
                  )}
                </VStack>
              )}

              {section === "automations" && (
                <VStack align="stretch" gap={4}>
                  <SectionHeader
                    icon={<Zap size={18} />}
                    accent="blue"
                    title="Automations"
                    count={traceAutomations.length}
                    summary="Act on every incoming trace that matches your filters."
                    details="An automation runs on each trace matching your filters: post to Slack or email, add rows to a dataset, or queue traces for annotation."
                    addLabel="New automation"
                    onAdd={() => openDrawer("automation", {})}
                  />
                  {traceAutomations.length === 0 ? (
                    <UseCaseStrip
                      kind="automation"
                      onOpen={(prefill) => openDrawer("automation", prefill)}
                    />
                  ) : (
                    <TableShell>
                      <Table.Root variant="line" width="full">
                        <Table.Header>
                          <Table.Row>
                            <Table.ColumnHeader>Name</Table.ColumnHeader>
                            <Table.ColumnHeader>Acts on</Table.ColumnHeader>
                            <Table.ColumnHeader>Then</Table.ColumnHeader>
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
                            <Table.ColumnHeader />
                          </Table.Row>
                        </Table.Header>
                        <Table.Body>
                          {traceAutomations.map((trigger) => {
                            const actionParams =
                              trigger.actionParams as TriggerActionParams;
                            const stats = statsByTriggerId.get(trigger.id);
                            return (
                              // Armed, the row can be handed to Langy; its own click (open the
                              // automation) is untouched. The chip id matches the one the
                              // `/automations/<id>` route derives, so the row and the open
                              // automation are one chip.
                              <LangyContextTarget
                                key={trigger.id}
                                target={automationContextChip({
                                  automationId: trigger.id,
                                  name: trigger.name,
                                })}
                              >
                              <Table.Row {...sharedRowProps(trigger)}>
                                <Table.Cell fontWeight="medium">
                                  {trigger.name}
                                </Table.Cell>
                                <Table.Cell maxWidth="360px">
                                  <VStack gap={2} align="stretch">
                                    {applyChecks(
                                      trigger.checks?.filter(
                                        (check): check is Monitor => !!check,
                                      ) ?? [],
                                    )}

                                    {trigger.filterQuery ? (
                                      // ADR-043: a trace-subject automation shows
                                      // its search query.
                                      <Code
                                        size="sm"
                                        variant="surface"
                                        whiteSpace="pre-wrap"
                                        wordBreak="break-word"
                                      >
                                        {trigger.filterQuery}
                                      </Code>
                                    ) : trigger.filters &&
                                      typeof trigger.filters === "string" &&
                                      trigger.filters !== "{}" ? (
                                      <FilterDisplay
                                        filters={trigger.filters}
                                        hasBorder={true}
                                      />
                                    ) : null}
                                  </VStack>
                                </Table.Cell>
                                <Table.Cell>
                                  <VStack align="start" gap={0}>
                                    <Text textStyle="sm" fontWeight="medium">
                                      {triggerActionName(trigger.action)}
                                    </Text>
                                    <Box textStyle="xs" color="fg.muted">
                                      {actionItems(
                                        trigger.action,
                                        actionParams,
                                      )}
                                    </Box>
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
                                <Table.Cell>
                                  {rowActionsMenu(trigger)}
                                </Table.Cell>
                              </Table.Row>
                              </LangyContextTarget>
                            );
                          })}
                        </Table.Body>
                      </Table.Root>
                    </TableShell>
                  )}
                </VStack>
              )}
            </>
          )}
        </VStack>
      </Box>
    </SectionNavigationLayout>
  );
}

function OverviewSectionHeading({
  title,
  summary,
}: {
  title: string;
  summary: string;
}) {
  return (
    <VStack align="start" gap={0.5}>
      <Text fontSize="lg" fontWeight="semibold">
        {title}
      </Text>
      <Text textStyle="sm" color="fg.muted">
        {summary}
      </Text>
    </VStack>
  );
}

function StatTile({
  label,
  value,
  sub,
  alert = false,
}: {
  label: string;
  value: React.ReactNode;
  sub: string;
  alert?: boolean;
}) {
  return (
    <Box
      borderWidth="1px"
      borderColor={alert ? "red.solid" : "border"}
      borderRadius="lg"
      padding={4}
      bg="bg.panel"
    >
      <Text
        textStyle="2xs"
        textTransform="uppercase"
        letterSpacing="0.04em"
        fontWeight="600"
        color={alert ? "red.fg" : "fg.muted"}
      >
        {label}
      </Text>
      <Text
        fontSize="2xl"
        fontWeight="semibold"
        lineHeight="1.2"
        marginTop={1}
        color={alert ? "red.fg" : "fg"}
      >
        {value}
      </Text>
      <Text textStyle="xs" color="fg.muted" marginTop={0.5} lineClamp={1}>
        {sub}
      </Text>
    </Box>
  );
}

export default withPermissionGuard("triggers:view", {
  layoutComponent: DashboardLayout,
})(AutomationsPage);
