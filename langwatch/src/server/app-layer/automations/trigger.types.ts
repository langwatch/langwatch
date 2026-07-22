import type { TRACE_EXPANSIONS } from "~/server/tracer/tracesMapping";
import type { Trace } from "@langwatch/contracts/tracer";

/**
 * The subset of a `Trigger.actionParams` the graph-alert evaluation and
 * notification paths read. (Relocated from the removed cron trigger tree —
 * ADR-034: the event-sourced path is now the sole graph-alert path.)
 */
export interface ActionParams {
  members?: string[] | null;
  dataset?: string | null;
  slackWebhook?: string | null;
  datasetMapping: {
    mapping: Record<string, { source: string; key: string; subkey: string }>;
    expansions: Set<keyof typeof TRACE_EXPANSIONS>;
  };
  datasetId: string;
  annotators?: { id: string; name: string }[];
  createdByUserId?: string;
  threshold?: number;
  operator?: string;
  timePeriod?: number;
  seriesName?: string;
}

/** One matched trace's rendered content, handed to the notification
 *  templates (email/Slack/webhook). */
export interface TriggerData {
  input: string;
  output: string;
  traceId?: string;
  graphId?: string;
  projectId: string;
  fullTrace: Trace;
}
