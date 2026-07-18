import type {
  GraphAlertOperator,
  GraphAlertTimePeriod,
} from "~/server/app-layer/triggers/graph-alert.builder";

/**
 * Client-side display typing for a `Trigger` row's `actionParams` JSON. The
 * persisted column is `Prisma.JsonValue`; the display surfaces (the
 * automations list, the view drawer, the graph-alert conditions cell) each
 * read a handful of known keys off it. This is the ONE shared subset those
 * surfaces cast to — keep it aligned with what `buildGraphAlertTriggerData`
 * writes and the per-action provider schemas validate, so a drift shows up in
 * one place instead of three hand-maintained copies.
 */
export interface TriggerActionParams {
  slackWebhook?: string;
  members?: string[];
  datasetId?: string;
  annotators?: { id: string; name: string }[];
  url?: string;
  method?: "POST" | "PUT" | "PATCH";
  // Graph-alert keys — present on rows where `customGraphId` is set.
  seriesName?: string;
  operator?: GraphAlertOperator;
  threshold?: number;
  timePeriod?: GraphAlertTimePeriod;
}
