import {
  Badge,
  Box,
  Button,
  Code,
  HStack,
  SimpleGrid,
  Table,
  Text,
  VStack,
} from "@chakra-ui/react";
import { useMemo } from "react";
import { Calendar, Edit2, Eye, Filter, MoreVertical, Trash, TrendingUp, Zap } from "react-feather";
import { FilterDisplay } from "../../ui/elements/filter-display";
import { ClampedText } from "../../ui/elements/clamped-text";
import { PageLayout } from "@langwatch/design-system/page-layout";
import {
  AUTOMATION_SECTIONS,
  AutomationsLayout,
  type AutomationSection,
} from "../../ui/sections/automations-layout";
import { Link } from "../../ui/elements/automation-link";
import { Menu } from "@langwatch/design-system/menu";
import { Switch } from "@langwatch/design-system/switch";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { AutomationHistory } from "../../features/overview/ui/elements/automation-history";
import { AutomationUseCaseStrip } from "../../features/overview/ui/elements/automation-use-case-strip";
import { type TriggerActionParams } from "../../features/overview/model/trigger-action-params";
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
} from "../../features/overview/ui/elements/automation-table-cells";
import { RUNAWAY_PAUSE_REASON, type TriggerAction } from "@langwatch/automation-contract";
import { CLIENT_PROVIDERS } from "../../features/authoring/ui/sections/client-providers";
import { AutomationDrawer } from "../../features/authoring/ui/sections/automation-drawer";
import { ViewAutomationDrawer } from "../../features/authoring/ui/sections/view-automation-drawer";
import type { Monitor } from "@langwatch/monitor-contract";
import { useOrganizationTeamProject } from "../../behavior/automation-session";
import { useAutomationToaster } from "../../behavior/automation-feedback";
import { useAutomationRouter } from "../../behavior/automation-router";
import { api, type RouterOutputs } from "../../behavior/automation-api";
import { formatTimeAgo } from "../../model/relative-time";

type EnhancedTrigger = RouterOutputs["automation"]["getTriggers"][number];

/**
 * The two editors this screen owns, addressed by its own query string.
 *
 * `platform/app` opened them through the application's drawer registry, which
 * writes a drawer NAME and its scalar props into the query string, and mounts
 * the component from a registry the whole application shares. That registry is
 * composition a feature-web package may not reach. What the addresses were ever
 * for is reopening the same editor from the same link, so the screen keeps them
 * itself and renders the editors inline — the answer the gateway family's
 * routing-policy editor gave, repeated by the me family's pull-request detail.
 *
 * `?automation=new` is a fresh create; any other value is the automation being
 * edited. The create prefills ride alongside it under their own keys.
 */
const EDIT_QUERY_KEY = "automation";
const VIEW_QUERY_KEY = "viewAutomation";
const NEW_AUTOMATION = "new";

/** The prefills a create can be opened with, as the query carries them. */
type AutomationCreatePrefill = {
  initialSource?: string;
  initialName?: string;
  initialAction?: string;
  initialFilters?: string;
  initialFilterQuery?: string;
};

const sectionDetails: Record<AutomationSection, { title: string; description: string }> = {
  overview: {
    title: "Overview",
    description: "See what is firing, what is scheduled next, and recent automation activity.",
  },
  automations: {
    title: "Automations",
    description: "Act on every incoming trace that matches your filters.",
  },
  alerts: {
    title: "Alerts",
    description: "Get told when a metric crosses a threshold and when it recovers.",
  },
  schedules: {
    title: "Schedules",
    description: "Send a dashboard, graph, or trace table on a recurring cadence.",
  },
};

/**
 * The automations screen: four tabs of one page.
 *
 * `platform/app` decided which tab was showing by matching the pathname, which
 * is a screen reading the address to learn something it was already told: the
 * route table gives each of the four URLs its own page key, and the frontend
 * feature maps a key to a screen. So the tab arrives as a prop, and the
 * pathname is nobody's business here.
 */
export function AutomationsPage({ section = "overview" }: { section?: AutomationSection } = {}) {
  const { project } = useOrganizationTeamProject();
  const toaster = useAutomationToaster();
  const router = useAutomationRouter();
  const details = sectionDetails[section];
  const basePath = project ? `/${project.slug}/automations` : "/auth/signin";

  const editing = router.query[EDIT_QUERY_KEY];
  const viewing = router.query[VIEW_QUERY_KEY];

  /**
   * Writes one of the two editor keys, dropping the other.
   *
   * `setQuery` replaces the whole query string, so switching from the viewer to
   * the editor is one write rather than a clear followed by a set — and closing
   * either one is an empty write, which is what takes the editor out of the
   * address so the link stops reopening it.
   */
  const openEdit = (automationId: string) =>
    router.push(`?${new URLSearchParams({ [EDIT_QUERY_KEY]: automationId }).toString()}`);
  const openView = (automationId: string) =>
    router.push(`?${new URLSearchParams({ [VIEW_QUERY_KEY]: automationId }).toString()}`);
  const openCreate = (prefill: AutomationCreatePrefill) =>
    router.push(
      `?${new URLSearchParams({
        [EDIT_QUERY_KEY]: NEW_AUTOMATION,
        ...Object.fromEntries(
          Object.entries(prefill).filter(
            (entry): entry is [string, string] => typeof entry[1] === "string",
          ),
        ),
      }).toString()}`,
    );
  const closeEditor = () => router.push("?");

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

  // How much each automation has been throttled today. Read separately from
  // the trigger rows because the counters live in Redis, not Postgres, and a
  // Redis outage should cost the page these badges rather than the whole list.
  const capStatus = api.automation.getDailyCapStatus.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project?.id },
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
    () => (triggers.data ?? []).filter((t) => !t.customGraphId && t.triggerKind !== "REPORT"),
    [triggers.data],
  );
  // Only needed to resolve dataset names on ADD_TO_DATASET rows. Gated on
  // the project being loaded (an empty projectId trips the permission
  // middleware with a spurious "no permission" toast) and on the list
  // actually containing a dataset automation.
  const hasDatasetTriggers = (triggers.data ?? []).some((t) => t.action === "ADD_TO_DATASET");
  const getDatasets = api.dataset.getAll.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project?.id && hasDatasetTriggers },
  );

  const reportsUseGraph = useMemo(
    () =>
      reports.some(
        (r) =>
          (r.actionParams as { source?: { kind?: string } } | null)?.source?.kind === "customGraph",
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
    () => new Map<string, unknown>((graphsQuery.data ?? []).map((g) => [g.id, g.graph as unknown])),
    [graphsQuery.data],
  );
  const graphNameById = useMemo(
    () =>
      new Map<string, string>(
        (graphsQuery.data ?? []).map((g) => [g.id, (g as { name?: string }).name ?? "graph"]),
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
          });
        },
      },
    );
  };

  const getDatasetName = (actionParams: TriggerActionParams) => {
    if (actionParams.datasetId) {
      return (
        <Link href={`/${project?.slug}/datasets/${actionParams.datasetId}`}>
          {getDatasets.data?.find((dataset) => dataset.id === actionParams.datasetId)?.name}
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
          });
          void triggers.refetch();
        },
        onError: () => {
          toaster.create({
            title: "Delete automation",
            type: "error",
            description: "Failed to delete automation",
          });
        },
      },
    );
  };

  // Pull from the provider registry so adding a new TriggerAction doesn't
  // need a parallel switch here.
  const triggerActionName = (action: TriggerAction) =>
    CLIENT_PROVIDERS[action]?.shared.label ?? action;

  const actionItems = (action: TriggerAction, actionParams: TriggerActionParams) => {
    switch (action) {
      case "SEND_SLACK_MESSAGE":
        return (
          <Tooltip content={(actionParams as { slackWebhook: string }).slackWebhook}>
            <Text lineClamp={1} display="block">
              Webhook
            </Text>
          </Tooltip>
        );
      case "SEND_EMAIL":
        return (actionParams as { members: string[] }).members?.join(", ");
      case "ADD_TO_DATASET":
        return getDatasetName(actionParams) ?? "";
      // A dataset or annotation-queue automation has no per-row destination
      // line; the delivery cell above already names the action.
      default:
        return null;
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
      .filter((word, index) => index !== 0 || word.toLowerCase() === "evaluations")
      .join(" ");

    return (
      <Box padding={1} fontWeight="500" textTransform="capitalize" color="fg.muted">
        {text.replace("_", " ")}
      </Box>
    );
  };

  const FilterValue = ({ children }: { children: React.ReactNode }) => {
    return (
      <Box padding={1} borderRightRadius="md">
        <ClampedText lineClamp={1}>{children}</ClampedText>
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
        <FilterValue>{checks.map((check) => check?.name).join(", ")}</FilterValue>
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
            openView(trigger.id);
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
            openEdit(trigger.id);
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

  // WHAT THE ROW LOST IN THE MOVE, said here because this is where it was.
  // Each row was wrapped in `<LangyContextTarget>` from `@langwatch/langy-web`,
  // so an armed page could hand the automation to Langy by click or drag. That
  // package is an ungoverned web package whose source every consumer compiles,
  // and compiling it needs an `es2023` library and a stylesheet declaration
  // that `apps/ui` would have to adopt for the whole application — a cost this
  // family may not impose on a global tsconfig. The affordance goes for now and
  // returns when `langy-web` publishes a governed surface. The me family
  // recorded the same loss for its own Langy entry. See
  // `dev/docs/plans/ui-family-move-manifests.md`.
  //
  // The `key` moved back onto the row with the wrapper gone.
  const sharedRowProps = (trigger: EnhancedTrigger) => ({
    key: trigger.id,
    "data-trigger-id": trigger.id,
    cursor: "pointer",
    _hover: { bg: "bg.muted" },
    onClick: () => openView(trigger.id),
  });

  const activeCell = (trigger: EnhancedTrigger) => {
    const skipped = capStatus.data?.counts[trigger.id]?.skipped ?? 0;
    const pausedForVolume = trigger.pausedReason === RUNAWAY_PAUSE_REASON;
    return (
      <Table.Cell
        textAlign="center"
        onClick={(event) => {
          event.stopPropagation();
        }}
      >
        <VStack gap={1} align="center">
          <Switch
            checked={trigger.active}
            inputProps={{ "aria-label": `Toggle ${trigger.name}` }}
            onCheckedChange={({ checked }) => {
              handleToggleTrigger(trigger.id, checked);
            }}
          />
          {/* An automation that is running but silently dropping matches is
              the confusing case: without this the customer sees it switched
              on and no records appearing, with nothing to explain the gap.
              `tabIndex` is what makes the tooltip reachable: Badge renders a
              plain span, and a span with no tab stop can be hovered but never
              focused, so the explanation would be mouse-only. */}
          {pausedForVolume ? (
            <Tooltip content="This automation matched almost every trace in the project, so we paused it. Narrow its condition, then switch it back on.">
              <Badge colorPalette="red" size="sm" tabIndex={0}>
                Paused
              </Badge>
            </Tooltip>
          ) : skipped > 0 ? (
            <Tooltip
              content={`This automation passed its daily limit of ${(
                capStatus.data?.cap ?? 0
              ).toLocaleString()} matches. It starts again tomorrow.`}
            >
              <Badge colorPalette="orange" size="sm" tabIndex={0}>
                {skipped.toLocaleString()} skipped today
              </Badge>
            </Tooltip>
          ) : null}
        </VStack>
      </Table.Cell>
    );
  };

  const isLoading = triggers.isLoading;

  const overview = useMemo(() => {
    const stats = [...statsByTriggerId.values()];
    const firingNow = stats.filter((stat) => stat.currentlyFiring).length;
    const fired30d = stats.reduce((sum, stat) => sum + (stat.recentFireCount ?? 0), 0);
    const next = (reportSchedules.data ?? [])
      .filter((schedule) => schedule.nextRunAt)
      .map((schedule) => ({
        at: new Date(schedule.nextRunAt!).getTime(),
        triggerId: schedule.triggerId,
      }))
      .sort((left, right) => left.at - right.at)[0];
    const nextName = next
      ? ((triggers.data ?? []).find((trigger) => trigger.id === next.triggerId)?.name ?? null)
      : null;

    return { firingNow, fired30d, next, nextName };
  }, [reportSchedules.data, statsByTriggerId, triggers.data]);

  return (
    <AutomationsLayout basePath={basePath}>
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
                    onAdd={() => openCreate({ initialSource: "customGraph" })}
                  />
                  {alerts.length === 0 ? (
                    <AutomationUseCaseStrip
                      kind="alert"
                      onOpen={(prefill) => openCreate(prefill)}
                    />
                  ) : (
                    <TableShell>
                      <Table.Root variant="line" width="full">
                        <Table.Header>
                          <Table.Row>
                            <Table.ColumnHeader>Name</Table.ColumnHeader>
                            <Table.ColumnHeader>Watches</Table.ColumnHeader>
                            <Table.ColumnHeader whiteSpace="nowrap">Fires when</Table.ColumnHeader>
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
                            const actionParams = trigger.actionParams as TriggerActionParams;
                            const stats = statsByTriggerId.get(trigger.id);
                            return (
                              <Table.Row {...sharedRowProps(trigger)}>
                                <Table.Cell fontWeight="medium">{trigger.name}</Table.Cell>
                                <Table.Cell maxWidth="260px">
                                  <AlertSubjectCell
                                    graphName={trigger.customGraph?.name ?? null}
                                    graph={graphJsonById.get(trigger.customGraphId ?? "")}
                                    seriesName={actionParams.seriesName}
                                  />
                                </Table.Cell>
                                <Table.Cell whiteSpace="nowrap">
                                  <AlertRuleCell actionParams={actionParams} />
                                </Table.Cell>
                                <Table.Cell>{actionItems(trigger.action, actionParams)}</Table.Cell>
                                <Table.Cell whiteSpace="nowrap">
                                  <LastFiredCell
                                    trigger={trigger}
                                    stats={stats}
                                    formatTimeAgo={formatTimeAgo}
                                  />
                                </Table.Cell>
                                <Table.Cell whiteSpace="nowrap">
                                  <FiringStatus firing={!!stats?.currentlyFiring} />
                                </Table.Cell>
                                {activeCell(trigger)}
                                <Table.Cell>{rowActionsMenu(trigger)}</Table.Cell>
                              </Table.Row>
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
                      sub={overview.firingNow > 0 ? "alerts over their threshold" : "all clear"}
                      alert={overview.firingNow > 0}
                    />
                    <StatTile
                      label="Fired (30 days)"
                      value={overview.fired30d.toLocaleString()}
                      sub="across every automation"
                    />
                    <StatTile
                      label="Next scheduled"
                      value={overview.next ? (formatTimeAgo(overview.next.at) ?? "—") : "—"}
                      sub={overview.nextName ?? "no schedules queued"}
                    />
                  </SimpleGrid>

                  <VStack align="stretch" gap={3} width="full">
                    <OverviewSectionHeading
                      title="Recent activity"
                      summary="See what alerts, schedules, and automations have done recently."
                    />
                    <AutomationHistory
                      fires={activity.data ?? []}
                      triggers={triggers.data ?? []}
                      isLoading={activity.isLoading}
                      onOpenAutomation={(triggerId) => openView(triggerId)}
                      formatTimeAgo={formatTimeAgo}
                    />
                  </VStack>

                  <VStack align="stretch" gap={4} width="full">
                    <OverviewSectionHeading
                      title="Popular uses"
                      summary="Start from a common workflow and tailor it to your project."
                    />
                    <VStack align="stretch" gap={2}>
                      <Text textStyle="xs" fontWeight="semibold" color="fg.muted">
                        Alerts
                      </Text>
                      <AutomationUseCaseStrip
                        kind="alert"
                        showLabel={false}
                        onOpen={(prefill) => openCreate(prefill)}
                      />
                    </VStack>
                    <VStack align="stretch" gap={2}>
                      <Text textStyle="xs" fontWeight="semibold" color="fg.muted">
                        Automations
                      </Text>
                      <AutomationUseCaseStrip
                        kind="automation"
                        showLabel={false}
                        onOpen={(prefill) => openCreate(prefill)}
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
                    onAdd={() => openCreate({ initialSource: "report" })}
                  />
                  {reports.length === 0 ? (
                    <EmptyHint>
                      No schedules yet. Create one for a recurring Slack or email digest.
                    </EmptyHint>
                  ) : (
                    <TableShell>
                      <Table.Root variant="line" width="full">
                        <Table.Header>
                          <Table.Row>
                            <Table.ColumnHeader>Name</Table.ColumnHeader>
                            <Table.ColumnHeader>Sends</Table.ColumnHeader>
                            <Table.ColumnHeader whiteSpace="nowrap">Schedule</Table.ColumnHeader>
                            <Table.ColumnHeader whiteSpace="nowrap">
                              <MetricHeader
                                label="Next run"
                                help="When this next goes out, straight from the scheduler. A paused schedule has no next run."
                              />
                            </Table.ColumnHeader>
                            <Table.ColumnHeader whiteSpace="nowrap">
                              <MetricHeader label="Last run" help="The last time this was sent." />
                            </Table.ColumnHeader>
                            <Table.ColumnHeader>Delivery</Table.ColumnHeader>
                            <Table.ColumnHeader>Active</Table.ColumnHeader>
                            <Table.ColumnHeader />
                          </Table.Row>
                        </Table.Header>
                        <Table.Body>
                          {reports.map((trigger) => {
                            const actionParams = trigger.actionParams as TriggerActionParams;
                            const schedule = (
                              actionParams as {
                                schedule?: {
                                  cron?: string;
                                  timezone?: string;
                                };
                              }
                            ).schedule;
                            return (
                              <Table.Row
                                key={trigger.id}
                                data-trigger-id={trigger.id}
                                cursor="pointer"
                                _hover={{ bg: "bg.muted" }}
                                onClick={() => openEdit(trigger.id)}
                              >
                                <Table.Cell fontWeight="medium">{trigger.name}</Table.Cell>
                                <Table.Cell>
                                  <ReportSubjectCell
                                    actionParams={actionParams}
                                    graphNameById={graphNameById}
                                  />
                                </Table.Cell>
                                <Table.Cell whiteSpace="nowrap">
                                  <Text textStyle="sm">
                                    {schedule?.cron
                                      ? describeSchedule(schedule.cron, schedule.timezone ?? "UTC")
                                      : "Not set"}
                                  </Text>
                                </Table.Cell>
                                <ReportRunCells
                                  schedule={scheduleByTriggerId.get(trigger.id)}
                                  loading={reportSchedules.isLoading}
                                  formatTimeAgo={formatTimeAgo}
                                />
                                <Table.Cell>
                                  {trigger.action === "SEND_SLACK_MESSAGE" ? "Slack" : "Email"}
                                </Table.Cell>
                                {activeCell(trigger)}
                                <Table.Cell>{rowActionsMenu(trigger)}</Table.Cell>
                              </Table.Row>
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
                    onAdd={() => openCreate({})}
                  />
                  {traceAutomations.length === 0 ? (
                    <AutomationUseCaseStrip
                      kind="automation"
                      onOpen={(prefill) => openCreate(prefill)}
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
                            const actionParams = trigger.actionParams as TriggerActionParams;
                            const stats = statsByTriggerId.get(trigger.id);
                            return (
                              <Table.Row {...sharedRowProps(trigger)}>
                                <Table.Cell fontWeight="medium">{trigger.name}</Table.Cell>
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
                                      <FilterDisplay filters={trigger.filters} hasBorder={true} />
                                    ) : null}
                                  </VStack>
                                </Table.Cell>
                                <Table.Cell>
                                  <VStack align="start" gap={0}>
                                    <Text textStyle="sm" fontWeight="medium">
                                      {triggerActionName(trigger.action)}
                                    </Text>
                                    <Box textStyle="xs" color="fg.muted">
                                      {actionItems(trigger.action, actionParams)}
                                    </Box>
                                  </VStack>
                                </Table.Cell>
                                <Table.Cell whiteSpace="nowrap">
                                  <LastFiredCell
                                    trigger={trigger}
                                    stats={stats}
                                    formatTimeAgo={formatTimeAgo}
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
                    </TableShell>
                  )}
                </VStack>
              )}
            </>
          )}
        </VStack>
      </Box>

      {/* Both editors are rendered by the screen that addresses them, so the
          link that carries `?automation=` reopens exactly what it named. */}
      {editing !== void 0 ? (
        <AutomationDrawer
          {...(editing !== NEW_AUTOMATION ? { automationId: editing } : {})}
          {...(router.query.initialSource ? { initialSource: router.query.initialSource } : {})}
          {...(router.query.initialName ? { initialName: router.query.initialName } : {})}
          {...(router.query.initialAction ? { initialAction: router.query.initialAction } : {})}
          {...(router.query.initialFilters ? { initialFilters: router.query.initialFilters } : {})}
          {...(router.query.initialFilterQuery
            ? { initialFilterQuery: router.query.initialFilterQuery }
            : {})}
          {...(router.query.source ? { source: router.query.source } : {})}
          onClose={closeEditor}
        />
      ) : null}
      {viewing !== void 0 ? (
        <ViewAutomationDrawer automationId={viewing} onClose={closeEditor} onEdit={openEdit} />
      ) : null}
    </AutomationsLayout>
  );
}

function OverviewSectionHeading({ title, summary }: { title: string; summary: string }) {
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

/**
 * The page as its route mounts it.
 *
 * `platform/app` exported it wrapped in
 * `withPermissionGuard("triggers:view", { layoutComponent: DashboardLayout })`.
 * Neither half travels: the permission policy is the route's and is stated in
 * `apps/ui/src/features/automations`, over the session capability, and the
 * layout is the application chrome this package may not import. What is left is
 * the page, and it is exported unwrapped so a test renders the page itself
 * rather than the policy around it.
 */
export default AutomationsPage;
