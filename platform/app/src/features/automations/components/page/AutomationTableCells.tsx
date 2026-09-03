import {
  Badge,
  Box,
  Button,
  Code,
  Heading,
  HStack,
  Table,
  Text,
  VStack,
} from "@chakra-ui/react";
import {
  CADENCE_LABELS,
  CADENCE_WINDOW_MS,
  type NotificationCadence,
} from "@langwatch/automations/cadences";
import { HelpCircle, Plus } from "react-feather";
import { FilterDisplay } from "~/components/automations/FilterDisplay";
import { ConfirmDialog } from "~/components/gateway/ConfirmDialog";
import { HoverableBigText } from "~/components/HoverableBigText";
import { Tooltip } from "~/components/ui/tooltip";
import {
  OPERATOR_LABELS,
  TIME_PERIOD_LABELS,
} from "~/features/automations/logic/draftReducer";
import { resolveSeriesLabel } from "~/features/automations/logic/seriesOptions";
import type { TriggerActionParams } from "~/features/automations/logic/triggerActionParams";
import { useSwitchToProjectIntegration } from "~/features/automations/logic/useSwitchToProjectIntegration";
import { describeError } from "~/features/errors";
import { LangyContextTarget } from "~/features/langy/components/LangyContextTarget";
import { automationContextChip } from "~/features/langy/logic/langyContextChips";
import type { Monitor, TriggerAction } from "~/generated/prisma/client";
import type { RouterOutputs } from "~/utils/api";
import { formatTimeAgo } from "~/utils/formatTimeAgo";

type EnhancedTrigger = RouterOutputs["automation"]["getTriggers"][number];
type TriggerStats = RouterOutputs["automation"]["getTriggerStats"][number];
type ReportSchedule = RouterOutputs["automation"]["getReportSchedules"][number];

/**
 * Row nudge for an automation that still stores its own Slack token
 * (ADR-093 §5). Delivery never retargets such a row on its own, so the only
 * thing that moves it onto the project integration is someone choosing to —
 * which means every unmigrated token has to stay visible where the automation
 * appears.
 *
 * The switch is confirmed, not one click: it deletes the only copy of a
 * credential the customer can no longer read or retype, and points the
 * automation at a workspace that may not be the one it posts to today. Same
 * ConfirmDialog the row's Delete uses, for the same reason.
 *
 * `workspaceName` is null when the project has no integration, and `canSwitch`
 * is false without `project:update` at this project — in either case the
 * automation is still flagged, but no affordance is offered that would break it
 * or be refused at the server.
 */
export function OwnSlackTokenNudge({
  projectId,
  automationId,
  automationName,
  workspaceName,
  canSwitch,
}: {
  projectId: string;
  automationId: string;
  automationName: string;
  workspaceName: string | null;
  canSwitch: boolean;
}) {
  const switchOver = useSwitchToProjectIntegration({
    projectId,
    automationId,
    automationName,
    workspaceName,
  });

  return (
    <VStack align="start" gap={0} paddingTop={1}>
      <Text textStyle="xs" color="fg.muted">
        Uses its own Slack token
      </Text>
      {/* Both gates hold here, not only in the caller's composition: without
          a workspace to fall through to, the switch would leave the
          automation unable to deliver, and the server refuses it. */}
      {canSwitch && workspaceName ? (
        <Button
          variant="plain"
          size="xs"
          height="auto"
          paddingX={0}
          color="fg.muted"
          _hover={{ color: "fg" }}
          loading={switchOver.isPending}
          onClick={(event) => {
            // The whole row opens the automation; this action is its own.
            event.stopPropagation();
            switchOver.setIsConfirming(true);
          }}
        >
          Use the project integration
        </Button>
      ) : null}
      {switchOver.isError ? (
        <Text textStyle="xs" color="fg.error">
          {describeError({
            error: switchOver.error,
            fallbackTitle: "Couldn't switch this automation",
          })}
        </Text>
      ) : null}
      <ConfirmDialog
        open={switchOver.isConfirming}
        onOpenChange={switchOver.setIsConfirming}
        title={switchOver.confirmation.title}
        message={switchOver.confirmation.message}
        confirmLabel={switchOver.confirmation.confirmLabel}
        tone="danger"
        loading={switchOver.isPending}
        onConfirm={switchOver.confirmSwitch}
      />
    </VStack>
  );
}

/** Column header with a help tooltip explaining the metric. */
export function MetricHeader({ label, help }: { label: string; help: string }) {
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
  const windowMs = CADENCE_WINDOW_MS[cadence as NotificationCadence] ?? 0;
  if (!active || windowMs <= 0) return null;

  const dueAt = lastFiredAt ? new Date(lastFiredAt).getTime() + windowMs : null;
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

export function LastFiredCell({
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

export function FiringStatus({ firing }: { firing: boolean }) {
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
export function SectionHeader({
  icon,
  accent,
  title,
  count,
  details,
  addLabel,
  onAdd,
}: {
  icon: React.ReactNode;
  accent: string;
  title: string;
  count: number;
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
      <HStack gap={2} align="center" flex={1} minWidth={0}>
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

/**
 * A report's next and last run, straight from the scheduler.
 *
 * The cron stored on the trigger only DESCRIBES the schedule — the scheduler
 * owns the instants — so these two cells are the only honest answer to "when
 * does this actually go out?". A report with no scheduler row has never been
 * scheduled (it was created before the schedule synced, or the scheduler is
 * not wired in this environment), which is different from one that is simply
 * paused, so the two say different things.
 */
export function ReportRunCells({
  schedule,
  loading,
}: {
  schedule?: ReportSchedule;
  loading: boolean;
}) {
  if (loading) {
    return (
      <>
        <Table.Cell>
          <Text textStyle="sm" color="fg.muted">
            …
          </Text>
        </Table.Cell>
        <Table.Cell>
          <Text textStyle="sm" color="fg.muted">
            …
          </Text>
        </Table.Cell>
      </>
    );
  }
  return (
    <>
      <Table.Cell whiteSpace="nowrap">
        {schedule?.nextRunAt ? (
          <Tooltip content={new Date(schedule.nextRunAt).toLocaleString()}>
            <Text textStyle="sm" cursor="help">
              {formatTimeAgo(new Date(schedule.nextRunAt).getTime())}
            </Text>
          </Tooltip>
        ) : (
          <Text textStyle="sm" color="fg.muted">
            {schedule ? "Paused" : "Not scheduled"}
          </Text>
        )}
      </Table.Cell>
      <Table.Cell whiteSpace="nowrap">
        {schedule?.lastRunAt ? (
          <Tooltip content={new Date(schedule.lastRunAt).toLocaleString()}>
            <Text textStyle="sm" cursor="help">
              {formatTimeAgo(new Date(schedule.lastRunAt).getTime())}
            </Text>
          </Tooltip>
        ) : (
          <Text textStyle="sm" color="fg.muted">
            Not yet
          </Text>
        )}
      </Table.Cell>
    </>
  );
}

/** Bordered table frame that scrolls horizontally instead of squishing
 *  columns on narrow viewports. The `css` block is the one place the three
 *  automation tables get their shared polish — a quiet uppercase header on a
 *  tinted strip, generous row height, and a soft hover — so no per-page table
 *  markup has to repeat it. */
export function TableShell({ children }: { children: React.ReactNode }) {
  return (
    <Box
      border="1px solid"
      borderColor="border"
      borderRadius="lg"
      overflow="hidden"
      bg="bg.panel"
    >
      <Box
        overflowX="auto"
        css={{
          // Percentage column widths only bind under a fixed layout, and they
          // only mean anything above a floor: without one, `width="full"`
          // shrinks the table to the shell at any cost, and the cost is the
          // Name column collapsing to its longest single word. Below this the
          // shell scrolls instead.
          "& table": { tableLayout: "fixed", minWidth: "1000px" },
          "& thead th": {
            backgroundColor: "var(--chakra-colors-bg-subtle)",
            fontSize: "11px",
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "0.04em",
            color: "var(--chakra-colors-fg-muted)",
            whiteSpace: "nowrap",
            paddingTop: "0.6rem",
            paddingBottom: "0.6rem",
            borderBottomColor: "var(--chakra-colors-border)",
          },
          "& tbody td": {
            paddingTop: "0.85rem",
            paddingBottom: "0.85rem",
            verticalAlign: "middle",
            borderColor: "var(--chakra-colors-border-muted)",
          },
          "& tbody tr:last-of-type td": { borderBottom: "none" },
        }}
      >
        {children}
      </Box>
    </Box>
  );
}

/** Muted one-liner shown in place of a table when a section is empty and has
 *  no dedicated use-case strip. */
export function EmptyHint({ children }: { children: React.ReactNode }) {
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

/**
 * The "Watches" cell for a graph-watching automation. Names the graph the way
 * the wizard's rail and review overview do — "Graph · <name>" — so the list and
 * the composer say one thing about the same row (ADR-093 §1).
 */
export function GraphWatchCell({
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
          {`Graph · ${graphName}`}
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

/** The firing rule under a graph-watching row's "Watches" cell. Mirrors the
 *  dashboard "Configure Alert" copy (`greater than`, `over 5 minutes`) so both
 *  creation paths read the same. */
export function AlertRuleCell({
  actionParams,
}: {
  actionParams: TriggerActionParams;
}) {
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

/** The subject cell of a trace-filter automation's row: which monitors apply
 *  and the saved search query (or the legacy structured filters). */
export function TraceFilterCell({
  checks,
  filterQuery,
  filters,
  applyChecks,
}: {
  checks: Monitor[];
  filterQuery: string | null;
  filters: unknown;
  applyChecks: (checks: Monitor[]) => React.ReactNode;
}) {
  return (
    <VStack gap={2} align="stretch" minWidth={0}>
      <Text textStyle="sm" fontWeight="medium" lineClamp={1}>
        Trace filter
      </Text>
      {applyChecks(checks)}
      {filterQuery ? (
        // ADR-043: a trace-subject automation shows its search query.
        <HoverableBigText lineClamp={2} expandedVersion={filterQuery}>
          <Code
            size="sm"
            variant="surface"
            display="block"
            minWidth={0}
            wordBreak="break-word"
          >
            {filterQuery}
          </Code>
        </HoverableBigText>
      ) : filters && typeof filters === "string" && filters !== "{}" ? (
        <FilterDisplay filters={filters} hasBorder={true} />
      ) : null}
    </VStack>
  );
}

/** One row of the automations table: a trace-filter or graph-watching
 *  automation, plus its delivery, metrics and actions. Extracted out of the
 *  table body's `.map` (rather than left inline) purely to keep that
 *  callback under the function-length limit — the row still closes over
 *  everything the page computed for it, just as named parameters instead of
 *  free variables. */
export function AutomationRow({
  trigger,
  graphJsonById,
  statsByTriggerId,
  applyChecks,
  actionItems,
  triggerActionName,
  slackWorkspaceName,
  canSwitchSlackToken,
  projectId,
  sharedRowProps,
  activeCell,
  rowActionsMenu,
}: {
  trigger: EnhancedTrigger;
  graphJsonById: Map<string, unknown>;
  statsByTriggerId: Map<string, TriggerStats>;
  applyChecks: (checks: Monitor[]) => React.ReactNode;
  actionItems: (
    action: TriggerAction,
    actionParams: TriggerActionParams,
  ) => React.ReactNode;
  triggerActionName: (action: TriggerAction) => string;
  slackWorkspaceName: string | null | undefined;
  canSwitchSlackToken: boolean;
  projectId: string;
  sharedRowProps: (
    trigger: EnhancedTrigger,
  ) => React.ComponentProps<typeof Table.Row>;
  activeCell: (trigger: EnhancedTrigger) => React.ReactNode;
  rowActionsMenu: (trigger: EnhancedTrigger) => React.ReactNode;
}) {
  const actionParams = trigger.actionParams as TriggerActionParams;
  const stats = statsByTriggerId.get(trigger.id);
  const isWatchingGraph = !!trigger.customGraphId;
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
        <Table.Cell fontWeight="medium">{trigger.name}</Table.Cell>
        <Table.Cell>
          {isWatchingGraph ? (
            <VStack gap={0} align="start" minWidth={0}>
              <GraphWatchCell
                graphName={trigger.customGraph?.name ?? null}
                graph={graphJsonById.get(trigger.customGraphId ?? "")}
                seriesName={actionParams.seriesName}
              />
              <AlertRuleCell actionParams={actionParams} />
            </VStack>
          ) : (
            <TraceFilterCell
              checks={
                trigger.checks?.filter((check): check is Monitor => !!check) ??
                []
              }
              filterQuery={trigger.filterQuery}
              filters={trigger.filters}
              applyChecks={applyChecks}
            />
          )}
        </Table.Cell>
        <Table.Cell>
          <VStack align="start" gap={0} minWidth={0}>
            <Text textStyle="sm" fontWeight="medium">
              {triggerActionName(trigger.action)}
            </Text>
            {/* Clamped, so it needs a reveal: the
                destination (a long email, a webhook
                URL) is the whole point of the cell.
                Not expandable — the dialog wants a
                string and these are nodes. */}
            <HoverableBigText
              textStyle="xs"
              color="fg.muted"
              width="full"
              lineClamp={2}
              overflowWrap="anywhere"
              expandable={false}
            >
              {actionItems(trigger.action, actionParams)}
            </HoverableBigText>
            {trigger.action === "SEND_SLACK_MESSAGE" &&
            actionParams.slackBotTokenSet ? (
              <OwnSlackTokenNudge
                projectId={projectId}
                automationId={trigger.id}
                automationName={trigger.name}
                workspaceName={slackWorkspaceName ?? null}
                canSwitch={canSwitchSlackToken}
              />
            ) : null}
          </VStack>
        </Table.Cell>
        <Table.Cell whiteSpace="nowrap">
          <LastFiredCell trigger={trigger} stats={stats} />
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
          {isWatchingGraph ? (
            <FiringStatus firing={!!stats?.currentlyFiring} />
          ) : (
            <Text textStyle="sm" color="fg.muted">
              —
            </Text>
          )}
        </Table.Cell>
        {activeCell(trigger)}
        <Table.Cell>{rowActionsMenu(trigger)}</Table.Cell>
      </Table.Row>
    </LangyContextTarget>
  );
}

/** Report "Sends" cell — what the report is about (the subject facet): a
 *  dashboard, a named custom graph, or a top-N trace table. */
export function ReportSubjectCell({
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
export function describeSchedule(cron: string, timezone: string): string {
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
