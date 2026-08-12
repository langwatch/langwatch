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
import { useMemo, useState } from "react";
import {
  Calendar,
  Edit2,
  Eye,
  Filter,
  MoreVertical,
  Plus,
  Trash,
  Zap,
} from "react-feather";
import { FilterDisplay } from "~/components/automations/FilterDisplay";
import { DashboardLayout } from "~/components/DashboardLayout";
import { ConfirmDialog } from "~/components/gateway/ConfirmDialog";
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
  describeSchedule,
  EmptyHint,
  FiringStatus,
  GraphWatchCell,
  LastFiredCell,
  MetricHeader,
  ReportRunCells,
  ReportSubjectCell,
  SectionHeader,
  TableShell,
} from "~/features/automations/components/page/AutomationTableCells";
import {
  type ConditionSource,
  presetLabels,
} from "~/features/automations/logic/draftReducer";
import {
  RUNAWAY_PAUSE_EXPLANATION,
  RUNAWAY_PAUSE_REASON,
} from "~/features/automations/logic/pauseReasons";
import { slackDestinationPresentation } from "~/features/automations/logic/slackDestinationPresentation";
import type { TriggerActionParams } from "~/features/automations/logic/triggerActionParams";
import { CLIENT_PROVIDERS } from "~/features/automations/providers/registry";
import { showErrorToast } from "~/features/errors";
import { LangyContextTarget } from "~/features/langy/components/LangyContextTarget";
import { automationContextChip } from "~/features/langy/logic/langyContextChips";
import type { Monitor, TriggerAction } from "~/generated/prisma/client";
import { useDrawer } from "~/hooks/useDrawer";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api, type RouterOutputs } from "~/utils/api";
import { useRouter } from "~/utils/compat/next-router";
import { formatTimeAgo } from "~/utils/formatTimeAgo";

type EnhancedTrigger = RouterOutputs["automation"]["getTriggers"][number];

/** What a saved row watches (`draft.source`), derived the same way the
 *  composer derives it — so the row-actions menu, the delete dialog, and the
 *  toast all name the row the way the customer does. Both automation subjects
 *  share one noun; only a report has its own (ADR-093 §1). */
function triggerSource(trigger: EnhancedTrigger): ConditionSource {
  if (trigger.customGraphId) return "customGraph";
  if (trigger.triggerKind === "REPORT") return "report";
  return "trace";
}

type AutomationSection = "overview" | "automations" | "reports";

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
    description:
      "Watch a trace filter or a graph, and act when something matches.",
  },
  reports: {
    title: "Reports",
    description:
      "Send a dashboard, graph, or trace table on a recurring schedule.",
  },
};

const sectionFromPath = (pathname: string): AutomationSection => {
  if (pathname.includes("/automations/automations")) return "automations";
  // Alerts and automations are one list now (ADR-093 §1). The old path keeps
  // resolving to it, so a link issued before the merge still lands on the row
  // it was pointing at rather than on a dead route.
  if (pathname.includes("/automations/alerts")) return "automations";
  // A report is what the third concept is called; "/schedules" is the path it
  // shipped under and keeps answering on, so no existing link breaks.
  if (pathname.includes("/automations/schedules")) return "reports";
  if (pathname.includes("/automations/reports")) return "reports";
  return "overview";
};

function AutomationsPage() {
  const { project } = useOrganizationTeamProject();
  const { openDrawer } = useDrawer();
  const router = useRouter();
  const section = sectionFromPath(router.pathname);
  const details = sectionDetails[section];
  const basePath = project ? `/${project.slug}/automations` : "/auth/signin";
  const trpcUtils = api.useContext();

  // Row pending a delete confirmation (#6716: deletion was immediate and
  // irreversible). Holding the row itself, not just its id, lets the dialog
  // and the toast name the row the way the customer does (automation /
  // report).
  const [pendingDelete, setPendingDelete] = useState<EnhancedTrigger | null>(
    null,
  );

  const triggers = api.automation.getTriggers.useQuery(
    {
      projectId: project?.id ?? "",
    },
    {
      enabled: !!project?.id,
    },
  );

  // Fire-history rollup for the metric columns (last fired, 30-day count,
  // open incidents). Triggers that never fired have no entry.
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

  // One table for everything that watches something (ADR-093 §1): a trace
  // filter and a graph metric are two subjects of one kind, not two kinds.
  // Reports keep their own tab — the clock is not something to watch.
  const reports = useMemo(
    () => (triggers.data ?? []).filter((t) => t.triggerKind === "REPORT"),
    [triggers.data],
  );
  const automations = useMemo(
    () => (triggers.data ?? []).filter((t) => t.triggerKind !== "REPORT"),
    [triggers.data],
  );
  const graphAutomationCount = useMemo(
    () => automations.filter((t) => !!t.customGraphId).length,
    [automations],
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
      enabled: !!project?.id && (graphAutomationCount > 0 || reportsUseGraph),
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

  const handleToggleTrigger = (trigger: EnhancedTrigger, active: boolean) => {
    const noun = presetLabels(triggerSource(trigger), false).noun;
    toggleTrigger.mutate(
      { triggerId: trigger.id, active, projectId: project?.id ?? "" },
      {
        onSuccess: () => {
          void triggers.refetch();
          // The view/edit drawers read this row by id — without invalidating
          // it too, reopening either after a toggle can still show the
          // pre-toggle active state until something else happens to refetch it.
          void trpcUtils.automation.getTriggerById.invalidate();
        },
        onError: (error) => {
          showErrorToast({
            error,
            fallbackTitle: `Couldn't update ${noun}`,
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

  const deleteTrigger = (trigger: EnhancedTrigger) => {
    const noun = presetLabels(triggerSource(trigger), false).noun;
    deleteTriggerMutation.mutate(
      { triggerId: trigger.id, projectId: project?.id ?? "" },
      {
        onSuccess: () => {
          toaster.create({
            title: `Delete ${noun}`,
            type: "success",
            description: `${noun.charAt(0).toUpperCase()}${noun.slice(1)} deleted`,
            meta: {
              closable: true,
            },
          });
          void triggers.refetch();
          // The view/edit drawers read this row by id — without invalidating
          // it too, a still-open drawer for the deleted row would keep
          // showing it as though nothing happened.
          void trpcUtils.automation.getTriggerById.invalidate();
          setPendingDelete(null);
        },
        onError: (error) => {
          showErrorToast({
            error,
            fallbackTitle: `Couldn't delete ${noun}`,
          });
          // Leave the dialog open so the author can retry or cancel — closing
          // it here would silently discard the confirmation they just gave.
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
        return <SlackNotifyCell actionParams={actionParams} />;
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

  const rowActionsMenu = (trigger: EnhancedTrigger) => {
    const noun = presetLabels(triggerSource(trigger), false).noun;
    return (
      <Menu.Root>
        <Menu.Trigger asChild>
          <Button
            variant={"ghost"}
            aria-label={`Actions for ${trigger.name}`}
            onClick={(event) => {
              event.stopPropagation();
            }}
          >
            <MoreVertical aria-hidden="true" />
          </Button>
        </Menu.Trigger>
        <Menu.Content>
          {/* `aria-label` is set explicitly (not left to the text content) so
              View/Edit/Delete keep an accessible name distinguishing the row
              they belong to — Playwright resolving them by their visible text
              alone was masking that the accessibility tree had nothing to
              announce. #6716. */}
          <Menu.Item
            value="view"
            aria-label={`View ${trigger.name}`}
            onClick={(event) => {
              event.stopPropagation();
              openDrawer("viewAutomation", { automationId: trigger.id });
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
            onClick={(event) => {
              event.stopPropagation();
              openDrawer("automation", { automationId: trigger.id });
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
            onClick={(event) => {
              event.stopPropagation();
              setPendingDelete(trigger);
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
  };

  // No `key` here: the row is wrapped by <LangyContextTarget>, and the key
  // belongs on the outermost element of the iteration, not on the row inside it.
  const sharedRowProps = (trigger: EnhancedTrigger) => ({
    "data-trigger-id": trigger.id,
    cursor: "pointer",
    _hover: { bg: "bg.muted" },
    onClick: () => openDrawer("viewAutomation", { automationId: trigger.id }),
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
              handleToggleTrigger(trigger, checked);
            }}
          />
          {/* An automation that is running but silently dropping matches is
              the confusing case: without this the customer sees it switched
              on and no records appearing, with nothing to explain the gap.
              `tabIndex` is what makes the tooltip reachable: Badge renders a
              plain span, and a span with no tab stop can be hovered but never
              focused, so the explanation would be mouse-only. */}
          {pausedForVolume ? (
            <Tooltip content={RUNAWAY_PAUSE_EXPLANATION}>
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
          label: "Reports",
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
              {section === "overview" && (
                <VStack align="stretch" gap={8} width="full">
                  {/* G5: the Overview had tiles, activity, and a use-case
                      strip, but no way to actually start creating something —
                      every other tab opens the composer from its own section
                      header. Two things can be created, because there are two
                      kinds left (ADR-093 §1): what an automation watches is
                      chosen inside its own first step, not here. */}
                  <HStack justify="flex-end">
                    <Menu.Root>
                      <Menu.Trigger asChild>
                        <Button size="sm" colorPalette="orange">
                          <Plus size={14} aria-hidden="true" /> Create
                        </Button>
                      </Menu.Trigger>
                      <Menu.Content>
                        <Menu.Item
                          value="automation"
                          onClick={() => openDrawer("automation", {})}
                        >
                          <Box display="flex" alignItems="center" gap={2}>
                            <Zap size={14} aria-hidden="true" />
                            New automation
                          </Box>
                        </Menu.Item>
                        <Menu.Item
                          value="report"
                          onClick={() =>
                            openDrawer("automation", {
                              initialSource: "report",
                            })
                          }
                        >
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
                      sub={
                        overview.firingNow > 0
                          ? "automations over their threshold"
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
                      sub={overview.nextName ?? "no reports queued"}
                    />
                  </SimpleGrid>

                  <VStack align="stretch" gap={3} width="full">
                    <OverviewSectionHeading
                      title="Recent activity"
                      summary="See what your automations and reports have done recently."
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
                    {/* Grouped by what each one watches, which is the only
                        distinction left between them (ADR-093 §1). */}
                    <VStack align="stretch" gap={2}>
                      <Text
                        textStyle="xs"
                        fontWeight="semibold"
                        color="fg.muted"
                      >
                        Watching a graph
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
                        Watching a trace filter
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
              {section === "reports" && (
                <VStack align="stretch" gap={4}>
                  <SectionHeader
                    icon={<Calendar size={18} />}
                    accent="purple"
                    title="Reports"
                    count={reports.length}
                    summary="Send a dashboard, a graph, or a table of traces on a recurring schedule."
                    details="A report bundles a dashboard, a single graph, or a top-N trace table into a Slack or email digest on the schedule you set."
                    addLabel="New report"
                    onAdd={() =>
                      openDrawer("automation", { initialSource: "report" })
                    }
                  />
                  {reports.length === 0 ? (
                    <EmptyHint>
                      No reports yet. Create one for a recurring Slack or email
                      digest.
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
                                help="When this next goes out, straight from the scheduler. A paused report has no next run."
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
                                    schedule={scheduleByTriggerId.get(
                                      trigger.id,
                                    )}
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
                    count={automations.length}
                    summary="Watch a trace filter or a graph, and act when something matches."
                    details="An automation watches either the traces matching your conditions or one series on an analytics graph. When it fires it posts to Slack or email, adds rows to a dataset, or queues traces for annotation."
                    addLabel="New automation"
                    onAdd={() => openDrawer("automation", {})}
                  />
                  {automations.length === 0 ? (
                    <VStack align="stretch" gap={4}>
                      <UseCaseStrip
                        kind="automation"
                        onOpen={(prefill) => openDrawer("automation", prefill)}
                      />
                      <UseCaseStrip
                        kind="alert"
                        showLabel={false}
                        onOpen={(prefill) => openDrawer("automation", prefill)}
                      />
                    </VStack>
                  ) : (
                    <TableShell>
                      <Table.Root variant="line" width="full">
                        <Table.Header>
                          <Table.Row>
                            <Table.ColumnHeader>Name</Table.ColumnHeader>
                            <Table.ColumnHeader>Watches</Table.ColumnHeader>
                            <Table.ColumnHeader>Delivery</Table.ColumnHeader>
                            <Table.ColumnHeader whiteSpace="nowrap">
                              <MetricHeader
                                label="Last fired"
                                help="When this automation last fired and ran its delivery. Automations on a digest schedule also show when the next bundled send is due."
                              />
                            </Table.ColumnHeader>
                            <Table.ColumnHeader whiteSpace="nowrap">
                              <MetricHeader
                                label="Fires (30 days)"
                                help="Times this automation fired in the last 30 days."
                              />
                            </Table.ColumnHeader>
                            <Table.ColumnHeader whiteSpace="nowrap">
                              <MetricHeader
                                label="Status"
                                help="A graph-watching automation is firing while its metric is past the threshold, and back to OK when it recovers."
                              />
                            </Table.ColumnHeader>
                            <Table.ColumnHeader>Active</Table.ColumnHeader>
                            <Table.ColumnHeader />
                          </Table.Row>
                        </Table.Header>
                        <Table.Body>
                          {automations.map((trigger) => {
                            const actionParams =
                              trigger.actionParams as TriggerActionParams;
                            const stats = statsByTriggerId.get(trigger.id);
                            const watchesGraph = !!trigger.customGraphId;
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
                                    {watchesGraph ? (
                                      <VStack gap={0} align="start">
                                        <GraphWatchCell
                                          graphName={
                                            trigger.customGraph?.name ?? null
                                          }
                                          graph={graphJsonById.get(
                                            trigger.customGraphId ?? "",
                                          )}
                                          seriesName={actionParams.seriesName}
                                        />
                                        <AlertRuleCell
                                          actionParams={actionParams}
                                        />
                                      </VStack>
                                    ) : (
                                      <VStack gap={2} align="stretch">
                                        <Text
                                          textStyle="sm"
                                          fontWeight="medium"
                                          lineClamp={1}
                                        >
                                          Trace filter
                                        </Text>
                                        {applyChecks(
                                          trigger.checks?.filter(
                                            (check): check is Monitor =>
                                              !!check,
                                          ) ?? [],
                                        )}

                                        {trigger.filterQuery ? (
                                          // ADR-043: a trace-subject automation
                                          // shows its search query.
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
                                    )}
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
                                  <Table.Cell whiteSpace="nowrap">
                                    {/* Only a threshold rule has something to
                                        be firing or recovered from; a trace
                                        filter acts per match and has no such
                                        state to report. */}
                                    {watchesGraph ? (
                                      <FiringStatus
                                        firing={!!stats?.currentlyFiring}
                                      />
                                    ) : (
                                      <Text textStyle="sm" color="fg.muted">
                                        —
                                      </Text>
                                    )}
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
      <ConfirmDialog
        open={!!pendingDelete}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        title={
          pendingDelete
            ? `Delete ${presetLabels(triggerSource(pendingDelete), false).noun}`
            : "Delete"
        }
        message={
          pendingDelete
            ? `This permanently deletes "${pendingDelete.name}". This action cannot be undone.`
            : ""
        }
        confirmLabel="Delete"
        tone="danger"
        loading={deleteTriggerMutation.isLoading}
        onConfirm={() => {
          if (pendingDelete) deleteTrigger(pendingDelete);
        }}
      />
    </SectionNavigationLayout>
  );
}

/**
 * The "Notifies" cell for a Slack automation row. #6244: this used to show
 * "Webhook" (with an empty tooltip) for every Slack row, including
 * bot-token deliveries that never carry a webhook at all. Shared decision
 * with `ViewAutomationDrawer.tsx`'s destination cell via
 * `slackDestinationPresentation`, so the two surfaces can't drift apart
 * again. Extracted out of `actionItems`'s switch (rather than inlined as a
 * branch there) purely to keep that switch's own complexity down — each
 * case stays a single expression.
 */
function SlackNotifyCell({
  actionParams,
}: {
  actionParams: TriggerActionParams;
}) {
  const destination = slackDestinationPresentation(actionParams);
  if (destination.kind === "bot") {
    return destination.channelId ? (
      <Text lineClamp={1} display="block">
        Slack app · channel {destination.channelId}
      </Text>
    ) : (
      <Text lineClamp={1} display="block" color="fg.muted">
        Slack app
      </Text>
    );
  }
  return destination.tooltipUrl ? (
    <Tooltip content={destination.tooltipUrl}>
      <Text lineClamp={1} display="block">
        Slack webhook
      </Text>
    </Tooltip>
  ) : (
    <Text lineClamp={1} display="block">
      Slack webhook
    </Text>
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
