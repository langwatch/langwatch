import {
  Badge,
  Box,
  Button,
  Heading,
  HStack,
  Table,
  Text,
  VStack,
} from "@chakra-ui/react";
import { HelpCircle, Plus } from "react-feather";
import {
  CADENCE_LABELS,
  CADENCE_WINDOW_MS,
  type NotificationCadence,
} from "~/automations/cadences";
import { Tooltip } from "~/components/ui/tooltip";
import {
  OPERATOR_LABELS,
  TIME_PERIOD_LABELS,
} from "~/features/automations/logic/draftReducer";
import { resolveSeriesLabel } from "~/features/automations/logic/seriesOptions";
import type { TriggerActionParams } from "~/features/automations/logic/triggerActionParams";
import type { RouterOutputs } from "~/utils/api";
import { formatTimeAgo } from "~/utils/formatTimeAgo";

type EnhancedTrigger = RouterOutputs["automation"]["getTriggers"][number];
type TriggerStats = RouterOutputs["automation"]["getTriggerStats"][number];
type ReportSchedule =
  RouterOutputs["automation"]["getReportSchedules"][number];

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

export function AlertSubjectCell({
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
