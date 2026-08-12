import type {
  GraphAlertOperator,
  GraphAlertTimePeriod,
} from "~/server/app-layer/automations/graph-alert.builder";

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
  /** How a Slack automation reaches Slack — a legacy incoming webhook, or a
   *  Slack app bot token posting via the Web API. Absent means `"webhook"`
   *  (back-compat for rows saved before this existed). Mirrors
   *  `SlackDeliveryMethod` in `@langwatch/automations/providers/slack`. */
  slackDelivery?: "webhook" | "bot";
  /** The bot-delivery destination channel's raw Slack id (e.g. `C0123456`).
   *  Only the id is ever persisted — the channel NAME shown while authoring
   *  comes from a live, bot-token-authenticated Slack API call the display
   *  surfaces don't have. */
  slackChannelId?: string;
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
