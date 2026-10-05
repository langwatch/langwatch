/**
 * What an automation Langy touched says on its card: kind, condition, where it
 * delivers and whether it runs. Pure, and tolerant of both shapes a card meets:
 * the public API's read (`graphAlert`, `report`, `kind`) and the saved row the
 * viewer's hydration returns (the rule inside `actionParams`, `triggerKind`).
 * Spec: specs/langy/langy-automations.feature.
 */

import { CADENCE_LABELS } from "@langwatch/automations/cadences";
import annotationQueueShared from "@langwatch/automations/providers/annotationQueue";
import datasetShared from "@langwatch/automations/providers/dataset";
import emailShared from "@langwatch/automations/providers/email";
import slackShared from "@langwatch/automations/providers/slack";
import webhookShared from "@langwatch/automations/providers/webhook";
import { z } from "zod";
import { isAutomationPauseReason } from "~/features/automations/logic/pauseReasons";
import { describeCron } from "~/features/automations/logic/reportSchedule";
import { slackDestinationPresentation } from "~/features/automations/logic/slackDestinationPresentation";
import {
  watchSummary,
  watchSummaryLine,
} from "~/features/automations/logic/watchSummary";
import type { RouterOutputs } from "~/utils/api";

export type LangyAutomationKind = "alert" | "report" | "automation";

export type LangyDestinationChannel =
  | "slack"
  | "email"
  | "webhook"
  | "dataset"
  | "annotationQueue";

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
  schedule: z
    .object({ cron: z.string(), timezone: z.string().optional() })
    .optional(),
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

/** The automation a result names, or null when the payload is not one. */
export function readAutomation(value: unknown): LangyAutomationRecord | null {
  const parsed = automationRecordSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** Every automation a result names: a list read, or the one a write returned. */
export function readAutomations(value: unknown): LangyAutomationRecord[] {
  if (Array.isArray(value)) return value.flatMap((row) => readRow(row));
  const single = readAutomation(value);
  if (single) return [single];
  const wrapped = z.object({ triggers: z.array(z.unknown()) }).safeParse(value);
  return wrapped.success ? wrapped.data.triggers.flatMap(readRow) : [];
}

function readRow(row: unknown): LangyAutomationRecord[] {
  const read = readAutomation(row);
  return read ? [read] : [];
}

/** The newer read wins field by field, so a pause's short answer keeps the rest. */
export function mergeAutomation({
  stated,
  fresh,
}: {
  stated: LangyAutomationRecord;
  fresh: LangyAutomationRecord | null;
}): LangyAutomationRecord {
  if (!fresh) return stated;
  return { ...stated, ...definedFields(fresh) };
}

function definedFields(
  record: LangyAutomationRecord,
): Partial<LangyAutomationRecord> {
  return Object.fromEntries(
    Object.entries(record).filter(([, value]) => value !== undefined),
  );
}

export function automationKind(
  record: LangyAutomationRecord,
): LangyAutomationKind {
  const kind = (record.kind ?? record.triggerKind ?? "").toUpperCase();
  if (kind === "REPORT" || record.report) return "report";
  if (kind === "ALERT" || record.customGraphId) return "alert";
  return "automation";
}

const OPERATOR_SYMBOL: Record<string, string> = {
  gt: ">",
  gte: "≥",
  lt: "<",
  lte: "≤",
  eq: "=",
};

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

/** The graph rule, from the API's `graphAlert` or the saved `actionParams`. */
function alertRule(record: LangyAutomationRecord) {
  const stated = graphAlertSchema.safeParse(record.graphAlert);
  if (stated.success) return stated.data;
  const saved = graphAlertSchema.safeParse(record.actionParams);
  return saved.success ? saved.data : null;
}

/** What the automation watches, in one line; null when nothing can be said. */
export function automationCondition(
  record: LangyAutomationRecord,
): string | null {
  switch (automationKind(record)) {
    case "alert":
      return alertCondition(record);
    case "report":
      return reportCondition(record);
    case "automation":
      return watchSummaryLine(
        watchSummary({
          isWatchingGraph: false,
          filterQuery: record.filterQuery,
          hasStructuredFilters: hasFilters(record.filters),
        }),
      );
  }
}

function alertCondition(record: LangyAutomationRecord): string | null {
  const rule = alertRule(record);
  if (!rule) return null;
  const symbol = OPERATOR_SYMBOL[rule.operator] ?? rule.operator;
  return `${seriesLabel(rule.seriesName)} ${symbol} ${rule.threshold} over ${windowLabel(rule.timePeriod)}`;
}

function reportCondition(record: LangyAutomationRecord): string | null {
  const stated = reportSchema.safeParse(record.report);
  const saved = reportSchema.safeParse(record.actionParams);
  const schedule =
    (stated.success ? stated.data.schedule : undefined) ??
    (saved.success ? saved.data.schedule : undefined);
  return schedule ? describeCron(schedule.cron, schedule.timezone ?? "") : null;
}

function hasFilters(filters: unknown): boolean {
  if (typeof filters === "string") return filters.trim().length > 2;
  return (
    !!filters && typeof filters === "object" && Object.keys(filters).length > 0
  );
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

/** Where the automation delivers. The Slack connection is named when known. */
export function automationDestinations({
  record,
  slackConnections,
}: {
  record: LangyAutomationRecord;
  slackConnections?: ReadonlyArray<{ id: string; name: string }>;
}): LangyAutomationDestination[] {
  const read = deliveryFieldsSchema.safeParse(record.actionParams ?? {});
  const fields = read.success ? read.data : {};
  const destination = DESTINATION_BY_ACTION[record.action ?? ""];
  return destination ? [destination({ fields, slackConnections })] : [];
}

type DeliveryFields = z.infer<typeof deliveryFieldsSchema>;
type DestinationReader = (a: {
  fields: DeliveryFields;
  slackConnections?: ReadonlyArray<{ id: string; name: string }>;
}) => LangyAutomationDestination;

const DESTINATION_BY_ACTION: Record<string, DestinationReader> = {
  SEND_SLACK_MESSAGE: ({ fields, slackConnections }) =>
    slackDestination({ fields, slackConnections }),
  SEND_EMAIL: ({ fields }) => ({
    channel: "email",
    label: emailShared.label,
    detail: listLabel(fields.members ?? []),
  }),
  SEND_WEBHOOK: ({ fields }) => ({
    channel: "webhook",
    label: webhookShared.label,
    detail: hostOf(fields.url),
  }),
  ADD_TO_DATASET: () => ({
    channel: "dataset",
    label: datasetShared.label,
    detail: null,
  }),
  ADD_TO_ANNOTATION_QUEUE: ({ fields }) => ({
    channel: "annotationQueue",
    label: annotationQueueShared.label,
    detail: listLabel((fields.annotators ?? []).map((a) => a.name)),
  }),
};

function slackDestination({
  fields,
  slackConnections,
}: {
  fields: DeliveryFields;
  slackConnections?: ReadonlyArray<{ id: string; name: string }>;
}): LangyAutomationDestination {
  const presented = slackDestinationPresentation({
    actionParams: fields,
    connections: slackConnections,
  });
  const channel =
    presented.kind === "bot" && presented.channelId
      ? channelLabel(presented.channelId)
      : null;
  return {
    channel: "slack",
    label: presented.connectionName ?? slackShared.label,
    detail: channel,
  };
}

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
  if (items.length === 0) return null;
  const [first, ...rest] = items;
  return rest.length === 0 ? (first ?? null) : `${first} +${rest.length}`;
}

/** The `automation.getNextFiring` answer, as the router returns it. */
export type LangyNextFiring = RouterOutputs["automation"]["getNextFiring"];

/** When it next acts, as one short line; the drawer carries the long copy. */
export function nextFiringLine(next: LangyNextFiring): string {
  switch (next.kind) {
    case "paused":
      return isAutomationPauseReason(next.pausedReason)
        ? "Paused by LangWatch for runaway volume"
        : "Paused, so nothing is sent";
    case "schedule":
      return next.nextRunAt
        ? `Sends next ${shortInstant(new Date(next.nextRunAt))}`
        : "Nothing on the calendar";
    case "digest":
      return `${CADENCE_LABELS[next.cadence]}, next batch ${shortInstant(new Date(next.windowClosesAt))}`;
    case "immediate":
      return "Acts on each matching trace";
    case "alert":
      return "Checked as data arrives";
    default: {
      const _exhaustive: never = next;
      return _exhaustive;
    }
  }
}

function shortInstant(at: Date): string {
  return at.toLocaleString(undefined, {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}
