import type { WireOf } from "@langwatch/api/web";
/**
 * What an automation Langy touched says on its card: kind, condition, where it delivers and
 * whether it runs. Pure, and tolerant of the public API's read (`graphAlert`, `report`, `kind`)
 * and the saved row (`actionParams`, `triggerKind`). Spec: specs/langy/langy-automations.feature.
 */
import {
  annotationQueueProvider,
  CADENCE_LABELS,
  datasetProvider,
  emailProvider,
  isAutomationPauseReason,
  type NextFiring,
  slackProvider,
  webhookProvider,
} from "@langwatch/automation-contract";
import { Temporal } from "@langwatch/time";
import { z } from "zod";

import {
  findSlackConnection,
  type NamedSlackConnection,
} from "../../../../model/slack/slack-connection-name.ts";

export type LangyAutomationKind = "alert" | "report" | "automation";

export type LangyDestinationChannel = "slack" | "email" | "webhook" | "dataset" | "annotationQueue";

/** One place an automation delivers to, safe to show: never a secret. */
export interface LangyAutomationDestination {
  channel: LangyDestinationChannel;
  label: string;
  detail: string | null;
}

const graphAlertSchema = z.object({
  seriesName: z.string(),
  operator: z.string(),
  threshold: z.number(),
  timePeriod: z.number(),
});

const reportSchema = z.object({
  schedule: z.object({ cron: z.string(), timezone: z.string().optional() }).optional(),
});

const automationRecordSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  action: z.string().optional(),
  active: z.boolean().optional(),
  kind: z.string().nullish(),
  triggerKind: z.string().nullish(),
  customGraphId: z.string().nullish(),
  filterQuery: z.string().nullish(),
  filters: z.unknown().optional(),
  actionParams: z.record(z.string(), z.unknown()).nullish(),
  graphAlert: z.unknown().optional(),
  report: z.unknown().optional(),
  pausedReason: z.string().nullish(),
  platformUrl: z.string().nullish(),
});

export type LangyAutomationRecord = z.infer<typeof automationRecordSchema>;

/** Every automation a result names: a list read, the one a write returned, or none. */
export function readAutomations(value: unknown): LangyAutomationRecord[] {
  if (Array.isArray(value)) return value.flatMap(readRow);
  const single = readRow(value);
  if (single.length > 0) return single;
  const wrapped = z.object({ triggers: z.array(z.unknown()) }).safeParse(value);
  return wrapped.success ? wrapped.data.triggers.flatMap(readRow) : [];
}

function readRow(row: unknown): LangyAutomationRecord[] {
  const parsed = automationRecordSchema.safeParse(row);
  return parsed.success ? [parsed.data] : [];
}

/** The newer read wins field by field, so a pause's short answer keeps the rest. */
export function mergeAutomation({
  stated,
  fresh,
}: {
  stated: LangyAutomationRecord;
  fresh: LangyAutomationRecord | undefined;
}): LangyAutomationRecord {
  if (!fresh) return stated;
  const defined = Object.fromEntries(
    Object.entries(fresh).filter(([, value]) => value !== undefined),
  );
  return { ...stated, ...defined };
}

export function automationKind(record: LangyAutomationRecord): LangyAutomationKind {
  const kind = (record.kind ?? record.triggerKind ?? "").toUpperCase();
  if (kind === "REPORT" || record.report) return "report";
  if (kind === "ALERT" || record.customGraphId) return "alert";
  return "automation";
}

const OPERATOR_SYMBOL: Record<string, string> = { gt: ">", gte: "≥", lt: "<", lte: "≤", eq: "=" };

/** `0/performance.completion_time/p95` reads as `p95 completion time`. */
export function seriesLabel(seriesName: string): string {
  const [, metric, aggregation] = seriesName.split("/");
  if (!metric) return seriesName;
  const words = (metric.split(".").pop() ?? metric).replace(/_/g, " ");
  return aggregation ? `${aggregation} ${words}` : words;
}

/** Minutes as the card says them: "5 min", "1 h", "1 day". */
export function windowLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 1440) return `${minutes / 60} h`;
  const days = minutes / 1440;
  return `${days} ${days === 1 ? "day" : "days"}`;
}

/** What the automation watches, in one line; undefined when nothing can be said. */
export function automationCondition(record: LangyAutomationRecord): string | undefined {
  switch (automationKind(record)) {
    case "alert":
      return alertCondition(record);
    case "report":
      return reportCondition(record);
    case "automation":
      return watchLine(record);
  }
}

function alertCondition(record: LangyAutomationRecord): string | undefined {
  const stated = graphAlertSchema.safeParse(record.graphAlert);
  const saved = graphAlertSchema.safeParse(record.actionParams);
  const rule = stated.success ? stated.data : saved.data;
  if (!rule) return undefined;
  const symbol = OPERATOR_SYMBOL[rule.operator] ?? rule.operator;
  const series = seriesLabel(rule.seriesName);
  return `${series} ${symbol} ${rule.threshold} over ${windowLabel(rule.timePeriod)}`;
}

function reportCondition(record: LangyAutomationRecord): string | undefined {
  const stated = reportSchema.safeParse(record.report);
  const saved = reportSchema.safeParse(record.actionParams);
  const schedule =
    (stated.success ? stated.data.schedule : undefined) ??
    (saved.success ? saved.data.schedule : undefined);
  if (!schedule) return undefined;
  return describeCron({ cron: schedule.cron, timezone: schedule.timezone ?? "" });
}

/** Automation's own "Watches" wording, duplicated for its one other reader (§3.4 rule 1). */
function watchLine(record: LangyAutomationRecord): string {
  const query = record.filterQuery?.trim();
  if (query) return `Trace filter · ${query}`;
  return hasFilters(record.filters) ? "Trace filter · Structured filters" : "Trace filter";
}

function hasFilters(filters: unknown): boolean {
  if (typeof filters === "string") return filters.trim().length > 2;
  return !!filters && typeof filters === "object" && Object.keys(filters).length > 0;
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Automation's schedule sentence for the three shapes its composer writes; else the raw cron. */
export function describeCron({ cron, timezone }: { cron: string; timezone: string }): string {
  const tz = timezone.trim() || "UTC";
  const [minute, hour, dom, month, dow, ...rest] = cron.trim().split(/\s+/);
  const inRange = (field: string | undefined, min: number, max: number) =>
    !!field && /^\d+$/.test(field) && Number(field) >= min && Number(field) <= max;
  if (rest.length > 0 || month !== "*" || !inRange(minute, 0, 59) || !inRange(hour, 0, 23)) {
    return `${cron.trim()} (${tz})`;
  }
  const at = `${(hour ?? "").padStart(2, "0")}:${(minute ?? "").padStart(2, "0")}`;
  if (dom === "*" && dow === "*") return `Sends every day at ${at} (${tz})`;
  if (dom === "*" && inRange(dow, 0, 6)) {
    return `Sends every ${WEEKDAYS[Number(dow)]} at ${at} (${tz})`;
  }
  if (dow === "*" && inRange(dom, 1, 31)) {
    return `Sends on the ${ordinal(Number(dom))} of each month at ${at} (${tz})`;
  }
  return `${cron.trim()} (${tz})`;
}

const ORDINAL_SUFFIX: Record<number, string> = { 1: "st", 2: "nd", 3: "rd" };

function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  return `${n}${ORDINAL_SUFFIX[n % 10] ?? "th"}`;
}

const deliveryFieldsSchema = z.object({
  slackIntegrationId: z.string().optional(),
  slackDelivery: z.enum(["webhook", "bot"]).optional(),
  slackChannelId: z.string().optional(),
  members: z.array(z.string()).optional(),
  url: z.string().optional(),
  datasetId: z.string().optional(),
  annotators: z.array(z.object({ name: z.string() })).optional(),
});

type DeliveryFields = z.infer<typeof deliveryFieldsSchema>;
type DestinationReader = (input: {
  fields: DeliveryFields;
  slackConnections: readonly NamedSlackConnection[] | undefined;
}) => LangyAutomationDestination;

/** Where the automation delivers. The Slack connection is named when known. */
export function automationDestinations({
  record,
  slackConnections,
}: {
  record: LangyAutomationRecord;
  slackConnections?: readonly NamedSlackConnection[];
}): LangyAutomationDestination[] {
  const read = deliveryFieldsSchema.safeParse(record.actionParams ?? {});
  const fields = read.success ? read.data : {};
  const destination = DESTINATION_BY_ACTION[record.action ?? ""];
  return destination ? [destination({ fields, slackConnections })] : [];
}

const DESTINATION_BY_ACTION: Record<string, DestinationReader> = {
  SEND_SLACK_MESSAGE: ({ fields, slackConnections }) => {
    const [connection] = findSlackConnection({
      connectionId: fields.slackIntegrationId,
      connections: slackConnections,
    });
    // Absent `slackDelivery` is a legacy webhook row, which names no channel.
    const channelId = fields.slackDelivery === "bot" ? fields.slackChannelId : undefined;
    return {
      channel: "slack",
      label: connection?.name ?? slackProvider.label,
      detail: channelId ? channelLabel(channelId) : null,
    };
  },
  SEND_EMAIL: ({ fields }) => ({
    channel: "email",
    label: emailProvider.label,
    detail: listLabel(fields.members ?? []),
  }),
  SEND_WEBHOOK: ({ fields }) => ({
    channel: "webhook",
    label: webhookProvider.label,
    detail: hostOf(fields.url),
  }),
  ADD_TO_DATASET: () => ({ channel: "dataset", label: datasetProvider.label, detail: null }),
  ADD_TO_ANNOTATION_QUEUE: ({ fields }) => ({
    channel: "annotationQueue",
    label: annotationQueueProvider.label,
    detail: listLabel((fields.annotators ?? []).map((annotator) => annotator.name)),
  }),
};

/** A channel name reads with its `#`; a raw Slack id (`C0123…`) as it is. */
export function channelLabel(channel: string): string {
  const trimmed = channel.trim();
  if (/^[CGD][A-Z0-9]{6,}$/.test(trimmed)) return trimmed;
  return `#${trimmed.replace(/^#/, "")}`;
}

/** Only the host: a webhook address can carry a token in its path or query. */
export function hostOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).host || null;
  } catch {
    return null;
  }
}

function listLabel(items: string[]): string | null {
  const [first, ...rest] = items;
  if (first === undefined) return null;
  return rest.length === 0 ? first : `${first} +${rest.length}`;
}

/** When it next acts, as one short line; the drawer carries the long copy. */
export function nextFiringLine(next: WireOf<NextFiring>): string {
  switch (next.kind) {
    case "paused":
      return isAutomationPauseReason(next.pausedReason)
        ? "Paused by LangWatch for runaway volume"
        : "Paused, so nothing is sent";
    case "schedule":
      return next.nextRunAt
        ? `Sends next ${shortInstant({ iso: next.nextRunAt })}`
        : "Nothing on the calendar";
    case "digest":
      return `${CADENCE_LABELS[next.cadence]}, next batch ${shortInstant({ iso: next.windowClosesAt })}`;
    case "immediate":
      return "Acts on each matching trace";
    case "alert":
      return "Checked as data arrives";
    default: {
      const exhaustive: never = next;
      return exhaustive;
    }
  }
}

function shortInstant({ iso }: { iso: string }): string {
  const at = Temporal.Instant.from(iso);
  return at.toLocaleString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" });
}
