import type {
  GraphAlertOperator,
  GraphAlertTimePeriod,
  SlackDeliveryMethod,
} from "@langwatch/automation-contract";

/** Display fields read from an automation row's action-parameters JSON. */
export interface TriggerActionParams {
  /** The Slack connection a Slack automation delivers through (ADR-093 §5a). */
  slackIntegrationId?: string;
  slackWebhook?: string;
  /** A legacy incoming webhook or a bot token via the Web API; absent means
   *  `"webhook"` (rows saved before this existed). */
  slackDelivery?: SlackDeliveryMethod;
  /** The bot destination's raw Slack channel id; only the id is persisted. */
  slackChannelId?: string;
  /** Read-only echo: the row stores a bot token; the token never reaches the browser. */
  slackBotTokenSet?: boolean;
  members?: string[];
  datasetId?: string;
  annotators?: { id: string; name: string }[];
  url?: string;
  method?: "POST" | "PUT" | "PATCH";
  seriesName?: string;
  operator?: GraphAlertOperator;
  threshold?: number;
  timePeriod?: GraphAlertTimePeriod;
}
