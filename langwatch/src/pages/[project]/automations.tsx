import {
  Badge,
  Box,
  Button,
  Container,
  Heading,
  HStack,
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
  Calendar,
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

/**
 * Section header for one automation kind. An accent-coloured icon chip gives
 * each kind its own identity so the three sections stop reading as one block;
 * the one-line summary is the scannable copy and the full explanation lives in
 * the `(?)` tooltip (per `copywriting.md`). `accent` is a Chakra colorPalette
 * token, shared with the section's chip, count badge and CTA.
 */
function SectionHeader({
  icon,
  accent,
  title,
  count,
  summary,
  details,
  addLabel,
  onAdd,
}: {
  icon: React.ReactNode;
  accent: string;
  title: string;
  count: number;
  summary: string;
  details: string;
  addLabel: string;
  onAdd: () => void;
}) {
  return (
    <HStack width="full" align="center" gap={3}>
      <Box
        colorPalette={accent}
        bg="colorPalette.subtle"
        color="colorPalette.fg"
        borderRadius="lg"
        padding={2}
        display="flex"
        flexShrink={0}
      >
        {icon}
      </Box>
      <VStack align="start" gap={0.5} flex={1} minWidth={0}>
        <HStack gap={2} align="center">
          <Heading size="md">{title}</Heading>
          <Badge colorPalette={accent} variant="subtle" borderRadius="full">
            {count}
          </Badge>
          <Tooltip content={details}>
            <Box color="fg.muted" display="inline-flex" cursor="help">
              <HelpCircle size={13} />
            </Box>
          </Tooltip>
        </HStack>
        <Text textStyle="sm" color="fg.muted">
          {summary}
        </Text>
      </VStack>
      <Button
        size="sm"
        variant="outline"
        colorPalette={accent}
        onClick={onAdd}
        flexShrink={0}
      >
        <Plus size={14} /> {addLabel}
      </Button>
    </HStack>
  );
}

/** Bordered table frame that scrolls horizontally instead of squishing
 *  columns on narrow viewports. */
function TableShell({ children }: { children: React.ReactNode }) {
  return (
    <Box
      border="1px solid"
      borderColor="border"
      borderRadius="lg"
      overflow="hidden"
    >
      <Box overflowX="auto">{children}</Box>
    </Box>
  );
}

/** Muted one-liner shown in place of a table when a section is empty and has
 *  no dedicated use-case strip. */
function EmptyHint({ children }: { children: React.ReactNode }) {
  return (
    <Box
      border="1px dashed"
      borderColor="border"
      borderRadius="lg"
      padding={6}
      textAlign="center"
    >
      <Text textStyle="sm" color="fg.muted">
        {children}
      </Text>
    </Box>
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
        <VStack align="stretch" gap={10}>
          <VStack align="start" gap={1}>
            <Heading>Alerts &amp; Automations</Heading>
            <Text textStyle="sm" color="fg.muted">
              Alerts watch a metric, reports go out on a schedule, and
              automations act on traces as they arrive.
            </Text>
          </VStack>

          {isLoading ? (
            <Text textStyle="sm" color="fg.muted">
              Loading...
            </Text>
          ) : (
            <>
              {/* Alerts — fire when a graph's metric crosses a threshold */}
              <VStack align="stretch" gap={4}>
                <SectionHeader
                  icon={<TrendingUp size={18} />}
                  accent="orange"
                  title="Alerts"
                  count={alerts.length}
                  summary="Get told when a metric crosses a threshold — and again when it recovers."
                  details="An alert watches one series on an analytics graph. When the value crosses your threshold it notifies your channel; when it returns to normal it sends a recovery notice."
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
                            <Table.Row {...sharedRowProps(trigger)}>
                              <Table.Cell fontWeight="medium">
                                {trigger.name}
                              </Table.Cell>
                              <Table.Cell maxWidth="260px">
                                <AlertSubjectCell
                                  graphName={trigger.customGraph?.name ?? null}
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
                              <Table.Cell>{rowActionsMenu(trigger)}</Table.Cell>
                            </Table.Row>
                          );
                        })}
                      </Table.Body>
                    </Table.Root>
                  </TableShell>
                )}
              </VStack>

              {/* Reports — send something on a recurring schedule */}
              <VStack align="stretch" gap={4}>
                <SectionHeader
                  icon={<Calendar size={18} />}
                  accent="purple"
                  title="Reports"
                  count={reports.length}
                  summary="Send a dashboard, a graph, or a table of traces on a recurring schedule."
                  details="A report bundles a dashboard, a single graph, or a top-N trace table into a Slack or email digest on the schedule you set. Upcoming send times are visible in Ops → Scheduler."
                  addLabel="New report"
                  onAdd={() =>
                    openDrawer("automation", { initialSource: "report" })
                  }
                />
                {reports.length === 0 ? (
                  <EmptyHint>
                    No scheduled reports yet — create one for a recurring Slack
                    or email digest.
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
                              schedule?: { cron?: string; timezone?: string };
                            }
                          ).schedule;
                          return (
                            <Table.Row
                              key={trigger.id}
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
                                    : "—"}
                                </Text>
                              </Table.Cell>
                              <Table.Cell>
                                {trigger.action === "SEND_SLACK_MESSAGE"
                                  ? "Slack"
                                  : "Email"}
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

              {/* Automations — act on each incoming trace that matches */}
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

                                  {trigger.filters &&
                                  typeof trigger.filters === "string" ? (
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
                                    {actionItems(trigger.action, actionParams)}
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
                              <Table.Cell>{rowActionsMenu(trigger)}</Table.Cell>
                            </Table.Row>
                          );
                        })}
                      </Table.Body>
                    </Table.Root>
                  </TableShell>
                )}
              </VStack>
            </>
          )}
        </VStack>
      </Container>
    </SettingsLayout>
  );
}

/** Alert "Watches" cell — the graph + series the alert is about (the subject
 *  facet). The stored series key resolves to its display name from the graph
 *  JSON; falls back to the raw key, or "Graph deleted" when the graph is gone. */
function AlertSubjectCell({
  graphName,
  graph,
  seriesName,
}: {
  graphName: string | null;
  graph?: unknown;
  seriesName?: string;
}) {
  const seriesLabel = seriesName
    ? (resolveSeriesLabel(graph, seriesName) ?? seriesName)
    : null;
  return (
    <VStack align="start" gap={0}>
      {graphName ? (
        <Text textStyle="sm" fontWeight="medium" lineClamp={1}>
          {graphName}
        </Text>
      ) : (
        <Text textStyle="sm" color="fg.muted">
          Graph deleted
        </Text>
      )}
      {seriesLabel ? (
        <Text textStyle="xs" color="fg.muted" lineClamp={1}>
          {seriesLabel}
        </Text>
      ) : null}
    </VStack>
  );
}

/** Alert "Fires when" cell — the threshold rule (the cadence facet). Mirrors
 *  the dashboard "Configure Alert" copy (`greater than`, `over 5 minutes`) so
 *  both creation paths read the same. */
function AlertRuleCell({ actionParams }: { actionParams: TriggerActionParams }) {
  const operator = actionParams.operator
    ? OPERATOR_LABELS[actionParams.operator]
    : null;
  const window = actionParams.timePeriod
    ? TIME_PERIOD_LABELS[actionParams.timePeriod]
    : null;
  if (!operator && actionParams.threshold === undefined) {
    return (
      <Text textStyle="sm" color="fg.muted">
        —
      </Text>
    );
  }
  return (
    <Text textStyle="sm">
      {operator ? `${operator} ` : ""}
      {actionParams.threshold !== undefined ? actionParams.threshold : ""}
      {window ? ` · over ${window}` : ""}
    </Text>
  );
}

/** Report "Sends" cell — what the report is about (the subject facet): a
 *  dashboard, a named custom graph, or a top-N trace table. */
function ReportSubjectCell({
  actionParams,
  graphNameById,
}: {
  actionParams: TriggerActionParams;
  graphNameById: Map<string, string>;
}) {
  const source = (
    actionParams as {
      source?: { kind?: string; topN?: number; customGraphId?: string };
    }
  ).source;
  if (source?.kind === "customGraph") {
    const name = source.customGraphId
      ? graphNameById.get(source.customGraphId)
      : undefined;
    return (
      <VStack align="start" gap={0}>
        <Text textStyle="sm" fontWeight="medium">
          Custom graph
        </Text>
        <Text textStyle="xs" color="fg.muted" lineClamp={1}>
          {name ?? "graph"}
        </Text>
      </VStack>
    );
  }
  if (source?.kind === "dashboard") {
    return (
      <Text textStyle="sm" fontWeight="medium">
        Analytics dashboard
      </Text>
    );
  }
  return (
    <VStack align="start" gap={0}>
      <Text textStyle="sm" fontWeight="medium">
        Top {source?.topN ?? 5} traces
      </Text>
      <Text textStyle="xs" color="fg.muted">
        matching your filters
      </Text>
    </VStack>
  );
}

/** Weekday names for `describeSchedule`, in cron `dow` order (0 = Sunday). */
const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

/** Humanises the cron shapes the report drawer emits (weekly / daily /
 *  monthly). Anything else falls back to the raw expression — a shape lookup
 *  for the presets we generate, not a general cron parser. */
function describeSchedule(cron: string, timezone: string): string {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return `${cron} (${timezone})`;
  const [min, hour, dom, , dow] = parts;
  const at = `${String(hour).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
  if (dom === "*" && dow !== "*") {
    const day = WEEKDAYS[Number(dow) % 7] ?? `day ${dow}`;
    return `Weekly · ${day} ${at} ${timezone}`;
  }
  if (dom === "*" && dow === "*") {
    return `Daily · ${at} ${timezone}`;
  }
  if (dom !== "*" && dow === "*") {
    return `Monthly · day ${dom} ${at} ${timezone}`;
  }
  return `${cron} (${timezone})`;
}

export default withPermissionGuard("triggers:view", {
  layoutComponent: SettingsLayout,
})(Automations);
