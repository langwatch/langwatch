import type { WireOf } from "@langwatch/api/web";
import {
  RUNAWAY_PAUSE_EXPLANATION,
  RUNAWAY_PAUSE_REASON,
  type TriggerAction,
} from "@langwatch/automation-contract";
import { Link } from "@langwatch/browser-host/link";
import { ConfirmDialog } from "@langwatch/design-system/confirm-dialog";
import { Menu } from "@langwatch/design-system/menu";
import {
  Badge,
  Box,
  Button,
  HStack,
  SimpleGrid,
  Table,
  Text,
  VStack,
} from "@langwatch/design-system/primitives";
import { Switch } from "@langwatch/design-system/switch";
import { Tooltip } from "@langwatch/design-system/tooltip";
import type { Monitor as StoredMonitor } from "@langwatch/monitor-contract";
import { type NamedSlackConnection } from "@langwatch/slack-contract";
import { toEpochMs } from "@langwatch/time";
import { useMemo, useState } from "react";
import { Calendar, Edit2, Eye, Filter, MoreVertical, Plus, Trash, Zap } from "react-feather";

import { api, type RouterOutputs } from "../../behavior/automation-api.ts";
import { useAutomationToaster, useShowErrorToast } from "../../behavior/automation-feedback.ts";
import { useOrganizationTeamProject } from "../../behavior/automation-session.ts";
import {
  useAutomationOverviewReads,
  useProjectDatasets,
  useProjectGraphs,
  useSlackConnections,
} from "../../behavior/use-automation-reads.ts";
import {
  type ConditionSource,
  presetLabels,
} from "../../features/authoring/model/draft-reducer.ts";
import { matchesEveryTrace } from "../../features/authoring/model/matches-every-trace.ts";
import { MatchesEveryTraceNotice } from "../../features/authoring/ui/elements/matches-every-trace-notice.tsx";
import { CLIENT_PROVIDERS } from "../../features/authoring/ui/sections/client-providers.ts";
import {
  slackDestinationLabel,
  slackDestinationPresentation,
} from "../../features/overview/model/slack-destination-presentation.ts";
import { type TriggerActionParams } from "../../features/overview/model/trigger-action-params.ts";
import { AutomationHistory } from "../../features/overview/ui/elements/automation-history.tsx";
import {
  AlertRuleCell,
  describeSchedule,
  EmailList,
  EmptyHint,
  FiringStatus,
  GraphWatchCell,
  LastFiredCell,
  MetricHeader,
  ReportRunCells,
  ReportSubjectCell,
  SectionHeader,
  TableShell,
  TraceFilterCell,
} from "../../features/overview/ui/elements/automation-table-cells.tsx";
import { AutomationUseCaseStrip } from "../../features/overview/ui/elements/automation-use-case-strip.tsx";
import { useAutomationHost } from "../../model/automation-host.ts";
import { formatTimeAgo } from "../../model/relative-time.ts";
import { ClampedText } from "../elements/clamped-text.tsx";
import { AutomationsLayout, type AutomationSection } from "./automations-layout.tsx";

/** A monitor as the browser holds one: the wire carries its instants as strings. */
type Monitor = WireOf<StoredMonitor>;

type EnhancedTrigger = RouterOutputs["automation"]["getTriggers"][number];
type TriggerStats = RouterOutputs["automation"]["getTriggerStats"][number];

/** What a saved row watches, derived the way the composer derives `draft.source`. */
function triggerSource(trigger: EnhancedTrigger): ConditionSource {
  if (trigger.customGraphId) return "customGraph";
  if (trigger.triggerKind === "REPORT") return "report";
  return "trace";
}

/** The customer's noun for a row, said by the menu, the dialog and both toasts (ADR-093 §1). */
function triggerNoun(trigger: EnhancedTrigger): string {
  return presetLabels({ source: triggerSource(trigger), isEdit: false }).noun;
}

/**
 * The two editors this screen opens, by registry name (drawers.md), via
 * shared `?drawer.open=` so every relay link resolves to the same editor;
 * create is this drawer with no id, not a `?automation=new` sentinel.
 */
const EDIT_DRAWER = "automation" as const;
const VIEW_DRAWER = "viewAutomation" as const;

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
    description: "Watch a trace filter or a graph, and act when something matches.",
  },
  reports: {
    title: "Reports",
    description: "Send a dashboard, graph, or trace table on a recurring schedule.",
  },
};

function FilterContainer({
  children,
  fontSize = "sm",
}: {
  children: React.ReactNode;
  fontSize?: string;
}) {
  return (
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
}

function FilterLabel({ children }: { children: string }) {
  const text = children
    .split(".")
    .filter((word, index) => index !== 0 || word.toLowerCase() === "evaluations")
    .join(" ");

  return (
    <Box padding={1} fontWeight="500" textTransform="capitalize" color="fg.muted">
      {text.replace("_", " ")}
    </Box>
  );
}

function FilterValue({ children }: { children: React.ReactNode }) {
  return (
    // minWidth 0 opts out of the flex child's min-width: auto, so a long
    // unbreakable value (a monitor id) clamps inside the chip instead of
    // widening it past its border.
    <Box padding={1} borderRightRadius="md" minWidth={0} overflow="hidden">
      <ClampedText lineClamp={1}>{children}</ClampedText>
    </Box>
  );
}

function applyChecks(checks: Monitor[]) {
  if (!checks || checks.length === 0) {
    return null;
  }

  return (
    <FilterContainer fontSize="sm">
      <FilterLabel>Evaluations</FilterLabel>
      <FilterValue>{checks.map((check) => check?.name).join(", ")}</FilterValue>
    </FilterContainer>
  );
}

function volumeBadge({
  pausedForVolume,
  skipped,
  cap,
}: {
  pausedForVolume: boolean;
  skipped: number;
  cap: number;
}) {
  if (pausedForVolume) {
    return (
      <Tooltip content={RUNAWAY_PAUSE_EXPLANATION}>
        <Badge colorPalette="red" size="sm" tabIndex={0}>
          Paused
        </Badge>
      </Tooltip>
    );
  }
  if (skipped > 0) {
    return (
      <Tooltip
        content={`This automation passed its daily limit of ${cap.toLocaleString()} matches. It starts again tomorrow.`}
      >
        <Badge colorPalette="orange" size="sm" tabIndex={0}>
          {skipped.toLocaleString()} skipped today
        </Badge>
      </Tooltip>
    );
  }
  return null;
}

type TriggerStatRow = { currentlyFiring?: boolean | null; recentFireCount?: number | null };

/** The overview tiles: what is firing, what fired lately, and the next scheduled report. */
function overviewOf<S extends TriggerStatRow>({
  stats,
  schedules,
  triggers,
}: {
  stats: S[];
  schedules: { nextRunAt?: Parameters<typeof toEpochMs>[0] | null; triggerId: string }[];
  triggers: { id: string; name: string }[];
}) {
  const firingNow = stats.filter((stat) => stat.currentlyFiring).length;
  const fired30d = stats.reduce((sum, stat) => sum + (stat.recentFireCount ?? 0), 0);
  const next = schedules
    .filter((schedule) => schedule.nextRunAt)
    .map((schedule) => ({
      at: toEpochMs(schedule.nextRunAt!),
      triggerId: schedule.triggerId,
    }))
    .toSorted((left, right) => left.at - right.at)[0];
  const nextName = next
    ? (triggers.find((trigger) => trigger.id === next.triggerId)?.name ?? null)
    : null;

  return { firingNow, fired30d, next, nextName };
}

/** The dataset an ADD_TO_DATASET automation writes to, as a link; empty when none is named. */
function datasetLinkOf({
  projectSlug,
  datasets,
  actionParams,
}: {
  projectSlug: string | undefined;
  datasets: { id: string; name: string }[] | undefined;
  actionParams: TriggerActionParams;
}) {
  if (!actionParams.datasetId) return "";
  return (
    <Link href={`/${projectSlug}/datasets/${actionParams.datasetId}`}>
      {datasets?.find((dataset) => dataset.id === actionParams.datasetId)?.name}
    </Link>
  );
}

/**
 * The automations screen: three tabs of one page. The tab arrives as a prop:
 * the route table gives each URL its own page key, and the retired alerts
 * path is handed "automations" (ADR-093 §1).
 */
export function AutomationsPage({ section = "overview" }: { section?: AutomationSection } = {}) {
  const { project } = useOrganizationTeamProject();
  const projectId = project?.id ?? "";
  const toaster = useAutomationToaster();
  const showErrorToast = useShowErrorToast();
  const host = useAutomationHost();
  const trpcUtils = api.useUtils();
  const details = sectionDetails[section];
  const basePath = project ? `/${project.slug}/automations` : "/auth/signin";

  const openEdit = (automationId: string) =>
    host.openDrawer({ drawer: EDIT_DRAWER, params: { automationId } });
  const openView = (automationId: string) =>
    host.openDrawer({ drawer: VIEW_DRAWER, params: { automationId } });
  const openCreate = (prefill: AutomationCreatePrefill) =>
    host.openDrawer({ drawer: EDIT_DRAWER, params: prefill });

  // Held as the row, not its id, so the dialog and toast name it (#6716).
  const [pendingDelete, setPendingDelete] = useState<EnhancedTrigger | undefined>(undefined);

  // One query for the whole table: every Slack row names its connection from it (ADR-093 §5a).
  const slackConnections = useSlackConnections({ projectId });
  // Fire-history rollup for the metric columns; triggers that never fired have no entry.
  // Throttle counters live in Redis: an outage costs these badges, not the list.
  // The scheduler owns a report's real instants; the cron only describes them.
  const { triggers, triggerStats, capStatus, reportSchedules, activity } =
    useAutomationOverviewReads({ projectId });
  const statsByTriggerId = useMemo(
    () => new Map((triggerStats.data ?? []).map((s) => [s.triggerId, s])),
    [triggerStats.data],
  );
  const scheduleByTriggerId = useMemo(
    () => new Map((reportSchedules.data ?? []).map((s) => [s.triggerId, s])),
    [reportSchedules.data],
  );

  // One table for everything that watches something (ADR-093 §1); reports keep their own tab.
  const reports = useMemo(
    () => (triggers.data ?? []).filter((t) => t.triggerKind === "REPORT"),
    [triggers.data],
  );
  const automations = useMemo(
    () => (triggers.data ?? []).filter((t) => t.triggerKind !== "REPORT"),
    [triggers.data],
  );
  const graphAutomationCount = automations.filter((t) => !!t.customGraphId).length;
  // Gated on the list holding a dataset automation; an empty projectId trips the permission check.
  const hasDatasetTriggers = (triggers.data ?? []).some((t) => t.action === "ADD_TO_DATASET");
  const getDatasets = useProjectDatasets({ projectId, enabled: hasDatasetTriggers });

  const reportsUseGraph = useMemo(
    () =>
      reports.some(
        (r) =>
          (r.actionParams as { source?: { kind?: string } } | null)?.source?.kind === "customGraph",
      ),
    [reports],
  );

  // Graph rows name their series from the graph's JSON; report rows need the graph's name.
  const graphsQuery = useProjectGraphs({
    projectId,
    enabled: graphAutomationCount > 0 || reportsUseGraph,
  });
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

  const handleToggleTrigger = ({
    trigger,
    active,
  }: {
    trigger: EnhancedTrigger;
    active: boolean;
  }) => {
    const noun = triggerNoun(trigger);
    toggleTrigger.mutate(
      { triggerId: trigger.id, active, projectId },
      {
        onSuccess: () => {
          void triggers.refetch();
          // The view and edit drawers read this row by id; reopening must not show the old state.
          void trpcUtils.automation.getTriggerById.invalidate();
        },
        onError: (error) => showErrorToast({ error, fallbackTitle: `Couldn't update ${noun}` }),
      },
    );
  };

  const deleteTrigger = (trigger: EnhancedTrigger) => {
    const noun = triggerNoun(trigger);
    deleteTriggerMutation.mutate(
      { triggerId: trigger.id, projectId },
      {
        onSuccess: () => {
          toaster.create({
            title: `Delete ${noun}`,
            type: "success",
            description: `${noun.charAt(0).toUpperCase()}${noun.slice(1)} deleted`,
          });
          void triggers.refetch();
          void trpcUtils.automation.getTriggerById.invalidate();
          setPendingDelete(undefined);
        },
        // The dialog stays open so the author can retry or cancel.
        onError: (error) => showErrorToast({ error, fallbackTitle: `Couldn't delete ${noun}` }),
      },
    );
  };

  const triggerActionName = (action: TriggerAction) =>
    CLIENT_PROVIDERS[action]?.shared.label ?? action;

  const actionItems = (action: TriggerAction, actionParams: TriggerActionParams) => {
    switch (action) {
      case "SEND_SLACK_MESSAGE":
        return (
          <SlackNotifyCell
            actionParams={actionParams}
            connections={slackConnections.data?.connections}
          />
        );
      case "SEND_EMAIL":
        return <EmailList emails={actionParams.members ?? []} />;
      case "ADD_TO_DATASET":
        return datasetLinkOf({
          projectSlug: project?.slug,
          datasets: getDatasets.data,
          actionParams,
        });
      case "SEND_WEBHOOK":
        return actionParams.url ?? "";
      default:
        return null;
    }
  };

  const rowActionsMenu = (trigger: EnhancedTrigger) => (
    <RowActionsMenu
      trigger={trigger}
      onView={() => openView(trigger.id)}
      onEdit={() => openEdit(trigger.id)}
      onDelete={() => setPendingDelete(trigger)}
    />
  );

  const sharedRowProps = (trigger: EnhancedTrigger) => ({
    "data-trigger-id": trigger.id,
    cursor: "pointer",
    _hover: { bg: "bg.muted" },
    onClick: () => openView(trigger.id),
  });

  const activeCell = (trigger: EnhancedTrigger) => (
    <Table.Cell
      textAlign="center"
      onClick={(event) => {
        event.stopPropagation();
      }}
    >
      <VStack gap={1} align="center">
        <Switch
          checked={trigger.active}
          data-testid={`automation-toggle-${trigger.name}`}
          inputProps={{ "aria-label": `Toggle ${trigger.name}` }}
          onCheckedChange={({ checked }) => {
            handleToggleTrigger({ trigger, active: checked });
          }}
        />
        {/* A running automation silently dropping matches is the confusing case. */}
        {volumeBadge({
          pausedForVolume: trigger.pausedReason === RUNAWAY_PAUSE_REASON,
          skipped: capStatus.data?.counts[trigger.id]?.skipped ?? 0,
          cap: capStatus.data?.cap ?? 0,
        })}
      </VStack>
    </Table.Cell>
  );

  const overview = useMemo(
    () =>
      overviewOf({
        stats: [...statsByTriggerId.values()],
        schedules: reportSchedules.data ?? [],
        triggers: triggers.data ?? [],
      }),
    [reportSchedules.data, statsByTriggerId, triggers.data],
  );

  const rowCells = {
    graphJsonById,
    statsByTriggerId,
    actionItems,
    triggerActionName,
    sharedRowProps,
    activeCell,
    rowActionsMenu,
  };

  return (
    <AutomationsLayout title={details.title} basePath={basePath} section={section}>
      <Box width="full">
        <VStack align="stretch" gap={6} width="full">
          <Text textStyle="sm" color="fg.muted">
            {details.description}
          </Text>

          {triggers.isLoading ? (
            <Text textStyle="sm" color="fg.muted">
              Loading...
            </Text>
          ) : (
            <>
              {section === "overview" && (
                <OverviewSection
                  overview={overview}
                  activity={activity.data ?? []}
                  isActivityLoading={activity.isLoading}
                  triggers={triggers.data ?? []}
                  openView={openView}
                  openCreate={openCreate}
                />
              )}
              {section === "reports" && (
                <ReportsSection
                  reports={reports}
                  graphNameById={graphNameById}
                  scheduleByTriggerId={scheduleByTriggerId}
                  isScheduleLoading={reportSchedules.isLoading}
                  openEdit={openEdit}
                  openCreate={openCreate}
                  activeCell={activeCell}
                  rowActionsMenu={rowActionsMenu}
                />
              )}
              {section === "automations" && (
                <AutomationsSection
                  automations={automations}
                  openCreate={openCreate}
                  rowCells={rowCells}
                />
              )}
            </>
          )}
        </VStack>
      </Box>
      <ConfirmDialog
        open={!!pendingDelete}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(undefined);
        }}
        title={pendingDelete ? `Delete ${triggerNoun(pendingDelete)}` : "Delete"}
        message={
          pendingDelete
            ? `This permanently deletes "${pendingDelete.name}". This action cannot be undone.`
            : ""
        }
        confirmLabel="Delete"
        tone="danger"
        loading={deleteTriggerMutation.isPending}
        onConfirm={() => {
          if (pendingDelete) deleteTrigger(pendingDelete);
        }}
      />
      {/* Neither editor renders here: `CurrentDrawer` mounts the one the address names. */}
    </AutomationsLayout>
  );
}

/** View, edit and delete for one row; each item names its row for assistive tech (#6716). */
function RowActionsMenu({
  trigger,
  onView,
  onEdit,
  onDelete,
}: {
  trigger: EnhancedTrigger;
  onView: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const noun = triggerNoun(trigger);
  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        <Button
          variant={"ghost"}
          aria-label={`Actions for ${trigger.name}`}
          data-testid={`automation-row-actions-${trigger.name}`}
          onClick={(event) => {
            event.stopPropagation();
          }}
        >
          <MoreVertical aria-hidden="true" />
        </Button>
      </Menu.Trigger>
      <Menu.Content>
        <Menu.Item
          value="view"
          aria-label={`View ${trigger.name}`}
          data-testid="automation-action-view"
          onClick={(event) => {
            event.stopPropagation();
            onView();
          }}
        >
          <Box display="flex" alignItems="center" gap={2}>
            <Eye size={14} aria-hidden="true" />
            View
          </Box>
        </Menu.Item>
        <Menu.Item
          value="edit"
          aria-label={`Edit ${trigger.name}`}
          data-testid="automation-action-edit"
          onClick={(event) => {
            event.stopPropagation();
            onEdit();
          }}
        >
          <Box display="flex" alignItems="center" gap={2}>
            <Edit2 size={14} aria-hidden="true" />
            Edit
          </Box>
        </Menu.Item>
        <Menu.Item
          value="delete"
          aria-label={`Delete ${noun} ${trigger.name}`}
          data-testid="automation-action-delete"
          onClick={(event) => {
            event.stopPropagation();
            onDelete();
          }}
        >
          <Box display="flex" alignItems="center" gap={2} color="red.fg">
            <Trash size={14} aria-hidden="true" />
            Delete {noun}
          </Box>
        </Menu.Item>
      </Menu.Content>
    </Menu.Root>
  );
}

/** The tiles, the Create menu, recent activity and the popular uses. */
function OverviewSection({
  overview,
  activity,
  isActivityLoading,
  triggers,
  openView,
  openCreate,
}: {
  overview: ReturnType<typeof overviewOf>;
  activity: RouterOutputs["automation"]["getRecentActivity"];
  isActivityLoading: boolean;
  triggers: EnhancedTrigger[];
  openView: (automationId: string) => void;
  openCreate: (prefill: AutomationCreatePrefill) => void;
}) {
  return (
    <VStack align="stretch" gap={8} width="full">
      {/* Two kinds can be created (ADR-093 §1); what an automation watches is its first step. */}
      <HStack justify="flex-end">
        <Menu.Root>
          <Menu.Trigger asChild>
            <Button size="sm" colorPalette="orange">
              <Plus size={14} aria-hidden="true" /> Create
            </Button>
          </Menu.Trigger>
          <Menu.Content>
            <Menu.Item value="automation" onClick={() => openCreate({})}>
              <Box display="flex" alignItems="center" gap={2}>
                <Zap size={14} aria-hidden="true" />
                New automation
              </Box>
            </Menu.Item>
            <Menu.Item value="report" onClick={() => openCreate({ initialSource: "report" })}>
              <Box display="flex" alignItems="center" gap={2}>
                <Calendar size={14} aria-hidden="true" />
                New report
              </Box>
            </Menu.Item>
          </Menu.Content>
        </Menu.Root>
      </HStack>

      <SimpleGrid columns={{ base: 1, md: 3 }} gap={4}>
        <StatTile
          label="Firing now"
          value={overview.firingNow}
          sub={overview.firingNow > 0 ? "automations over their threshold" : "all clear"}
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
          sub={overview.nextName ?? "no reports queued"}
        />
      </SimpleGrid>

      <VStack align="stretch" gap={3} width="full">
        <OverviewSectionHeading
          title="Recent activity"
          summary="See what your automations and reports have done recently."
        />
        <AutomationHistory
          fires={activity}
          triggers={triggers}
          isLoading={isActivityLoading}
          onOpenAutomation={openView}
          formatTimeAgo={formatTimeAgo}
        />
      </VStack>

      <VStack align="stretch" gap={4} width="full">
        <OverviewSectionHeading
          title="Popular uses"
          summary="Start from a common workflow and tailor it to your project."
        />
        {/* Grouped by what each one watches, the only distinction left (ADR-093 §1). */}
        <VStack align="stretch" gap={2}>
          <Text textStyle="xs" fontWeight="semibold" color="fg.muted">
            Watching a graph
          </Text>
          <AutomationUseCaseStrip kind="alert" showLabel={false} onOpen={openCreate} />
        </VStack>
        <VStack align="stretch" gap={2}>
          <Text textStyle="xs" fontWeight="semibold" color="fg.muted">
            Watching a trace filter
          </Text>
          <AutomationUseCaseStrip kind="automation" showLabel={false} onOpen={openCreate} />
        </VStack>
      </VStack>
    </VStack>
  );
}

/** The reports table: what each sends, on what schedule, and when it next and last ran. */
function ReportsSection({
  reports,
  graphNameById,
  scheduleByTriggerId,
  isScheduleLoading,
  openEdit,
  openCreate,
  activeCell,
  rowActionsMenu,
}: {
  reports: EnhancedTrigger[];
  graphNameById: Map<string, string>;
  scheduleByTriggerId: Map<string, RouterOutputs["automation"]["getReportSchedules"][number]>;
  isScheduleLoading: boolean;
  openEdit: (automationId: string) => void;
  openCreate: (prefill: AutomationCreatePrefill) => void;
  activeCell: (trigger: EnhancedTrigger) => React.ReactNode;
  rowActionsMenu: (trigger: EnhancedTrigger) => React.ReactNode;
}) {
  return (
    <VStack align="stretch" gap={4}>
      <SectionHeader
        icon={<Calendar size={18} />}
        accent="purple"
        title="Reports"
        count={reports.length}
        details="A report bundles a dashboard, a single graph, or a top-N trace table into a Slack or email digest on the schedule you set."
        addLabel="New report"
        onAdd={() => openCreate({ initialSource: "report" })}
      />
      {reports.length === 0 ? (
        <EmptyHint>No reports yet. Create one for a recurring Slack or email digest.</EmptyHint>
      ) : (
        <TableShell>
          <Table.Root variant="line" width="full">
            <Table.Header>
              <Table.Row>
                <Table.ColumnHeader width="20%">Name</Table.ColumnHeader>
                <Table.ColumnHeader width="17%">Sends</Table.ColumnHeader>
                <Table.ColumnHeader width="16%">Schedule</Table.ColumnHeader>
                <Table.ColumnHeader width="12%">
                  <MetricHeader
                    label="Next run"
                    help="When this next goes out, straight from the scheduler. A paused report has no next run."
                  />
                </Table.ColumnHeader>
                <Table.ColumnHeader width="12%">
                  <MetricHeader label="Last run" help="The last time this was sent." />
                </Table.ColumnHeader>
                <Table.ColumnHeader width="9%">Delivery</Table.ColumnHeader>
                <Table.ColumnHeader width="7%">Active</Table.ColumnHeader>
                <Table.ColumnHeader width="7%" />
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {reports.map((trigger) => {
                const actionParams = trigger.actionParams as TriggerActionParams;
                const schedule = (
                  actionParams as { schedule?: { cron?: string; timezone?: string } }
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
                    {/* No nowrap: a cadence plus an IANA zone is wider than this column. */}
                    <Table.Cell>
                      <Text textStyle="sm">
                        {schedule?.cron
                          ? describeSchedule(schedule.cron, schedule.timezone ?? "UTC")
                          : "Not set"}
                      </Text>
                    </Table.Cell>
                    <ReportRunCells
                      schedule={scheduleByTriggerId.get(trigger.id)}
                      loading={isScheduleLoading}
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
  );
}

/** The cells a row closes over, computed once by the page. */
interface RowCells {
  graphJsonById: Map<string, unknown>;
  statsByTriggerId: Map<string, TriggerStats>;
  actionItems: (action: TriggerAction, actionParams: TriggerActionParams) => React.ReactNode;
  triggerActionName: (action: TriggerAction) => string;
  sharedRowProps: (trigger: EnhancedTrigger) => React.ComponentProps<typeof Table.Row>;
  activeCell: (trigger: EnhancedTrigger) => React.ReactNode;
  rowActionsMenu: (trigger: EnhancedTrigger) => React.ReactNode;
}

/** One table for trace-filter and graph-watching automations (ADR-093 §1). */
function AutomationsSection({
  automations,
  openCreate,
  rowCells,
}: {
  automations: EnhancedTrigger[];
  openCreate: (prefill: AutomationCreatePrefill) => void;
  rowCells: RowCells;
}) {
  return (
    <VStack align="stretch" gap={4}>
      <SectionHeader
        icon={<Zap size={18} />}
        accent="blue"
        title="Automations"
        count={automations.length}
        details="An automation watches either the traces matching your conditions or one series on an analytics graph. When it fires it posts to Slack or email, adds rows to a dataset, or queues traces for annotation."
        addLabel="New automation"
        onAdd={() => openCreate({})}
      />
      {automations.length === 0 ? (
        <VStack align="stretch" gap={4}>
          <AutomationUseCaseStrip kind="automation" onOpen={openCreate} />
          <AutomationUseCaseStrip kind="alert" showLabel={false} onOpen={openCreate} />
        </VStack>
      ) : (
        <TableShell>
          <Table.Root variant="line" width="full">
            <Table.Header>
              <Table.Row>
                <Table.ColumnHeader width="19%">Name</Table.ColumnHeader>
                <Table.ColumnHeader width="20%">Watches</Table.ColumnHeader>
                <Table.ColumnHeader width="14%">Delivery</Table.ColumnHeader>
                <Table.ColumnHeader width="12%">
                  <MetricHeader
                    label="Last fired"
                    help="When this automation last fired and ran its delivery. Automations on a digest schedule also show when the next bundled send is due."
                  />
                </Table.ColumnHeader>
                <Table.ColumnHeader width="11%">
                  <MetricHeader
                    label="Fires (30 days)"
                    help="Times this automation fired in the last 30 days."
                  />
                </Table.ColumnHeader>
                <Table.ColumnHeader width="10%">
                  <MetricHeader
                    label="Status"
                    help="A graph-watching automation is firing while its metric is past the threshold, and back to OK when it recovers."
                  />
                </Table.ColumnHeader>
                <Table.ColumnHeader width="7%">Active</Table.ColumnHeader>
                <Table.ColumnHeader width="7%" />
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {automations.map((trigger) => (
                <AutomationRow key={trigger.id} trigger={trigger} cells={rowCells} />
              ))}
            </Table.Body>
          </Table.Root>
        </TableShell>
      )}
    </VStack>
  );
}

/** One automation row: what it watches, where it delivers, its metrics and its actions. */
function AutomationRow({ trigger, cells }: { trigger: EnhancedTrigger; cells: RowCells }) {
  const actionParams = trigger.actionParams as TriggerActionParams;
  const stats = cells.statsByTriggerId.get(trigger.id);
  return (
    <Table.Row {...cells.sharedRowProps(trigger)}>
      <Table.Cell fontWeight="medium">{trigger.name}</Table.Cell>
      <Table.Cell>
        {trigger.customGraphId ? (
          <VStack gap={0} align="start" minWidth={0}>
            <GraphWatchCell
              graphName={trigger.customGraph?.name ?? null}
              graph={cells.graphJsonById.get(trigger.customGraphId)}
              seriesName={actionParams.seriesName}
            />
            <AlertRuleCell actionParams={actionParams} />
          </VStack>
        ) : (
          <TraceWatchCell trigger={trigger} />
        )}
      </Table.Cell>
      <Table.Cell>
        <VStack align="start" gap={0} minWidth={0}>
          <Text textStyle="sm" fontWeight="medium">
            {cells.triggerActionName(trigger.action)}
          </Text>
          {/* Clamped, so it needs a reveal: the destination is the whole point of the cell. */}
          <ClampedText
            textStyle="xs"
            color="fg.muted"
            width="full"
            lineClamp={2}
            overflowWrap="anywhere"
          >
            {cells.actionItems(trigger.action, actionParams)}
          </ClampedText>
        </VStack>
      </Table.Cell>
      <Table.Cell>
        <LastFiredCell trigger={trigger} stats={stats} formatTimeAgo={formatTimeAgo} />
      </Table.Cell>
      <Table.Cell>
        <Text as="span" color="fg.muted">
          {stats?.recentFireCount ?? 0}
        </Text>
      </Table.Cell>
      {/* Only a threshold rule has something to be firing or recovered from. */}
      <Table.Cell whiteSpace="nowrap">
        {trigger.customGraphId ? (
          <FiringStatus firing={!!stats?.currentlyFiring} />
        ) : (
          <Text textStyle="sm" color="fg.muted">
            —
          </Text>
        )}
      </Table.Cell>
      {cells.activeCell(trigger)}
      <Table.Cell>{cells.rowActionsMenu(trigger)}</Table.Cell>
    </Table.Row>
  );
}

/** A trace-filter row's subject, flagged when it has no condition at all. */
function TraceWatchCell({ trigger }: { trigger: EnhancedTrigger }) {
  const checks = trigger.checks?.filter((check): check is Monitor => !!check) ?? [];
  const isUnconditioned = matchesEveryTrace({
    filterQuery: trigger.filterQuery,
    filters: trigger.filters,
    checkCount: checks.length,
  });
  return (
    <TraceFilterCell
      notice={isUnconditioned ? <MatchesEveryTraceNotice /> : null}
      checks={applyChecks(checks)}
      filterQuery={trigger.filterQuery}
      filters={trigger.filters}
    />
  );
}

/** A Slack row's connection and, for a bot, the channel; shared with the view drawer (#6244). */
function SlackNotifyCell({
  actionParams,
  connections,
}: {
  actionParams: TriggerActionParams;
  connections: readonly NamedSlackConnection[] | undefined;
}) {
  const destination = slackDestinationPresentation({ actionParams, connections });
  const label = slackDestinationLabel(destination);
  const text = (
    <Text lineClamp={1} display="block">
      {label}
    </Text>
  );
  if (destination.kind === "webhook" && destination.tooltipUrl) {
    return <Tooltip content={destination.tooltipUrl}>{text}</Tooltip>;
  }
  return text;
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
 * The page as its route mounts it, exported unwrapped: the permission
 * policy lives in `apps/ui/src/features/automations` and the layout chrome
 * is the application's, neither of which this package may import.
 */
export default AutomationsPage;
