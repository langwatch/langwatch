import type { GraphAlertOperator, GraphAlertTimePeriod } from "@langwatch/automation-contract";

/** Display fields read from an automation row's action-parameters JSON. */
export interface TriggerActionParams {
  slackWebhook?: string;
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
