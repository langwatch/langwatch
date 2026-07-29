import type { Project, Trigger } from "@prisma/client";
import type { TRACE_EXPANSIONS } from "~/server/tracer/tracesMapping";
import type { Trace } from "~/server/tracer/types";

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

export interface TriggerData {
  input: string;
  output: string;
  traceId?: string;
  graphId?: string;
  projectId: string;
  fullTrace: Trace;
}

/**
 * What the cron actually measured when a custom-graph alert crossed its
 * threshold.
 *
 * The action handlers render the SAME Liquid alert templates the event-sourced
 * path renders, and those templates read `metric.*`, `condition.*`,
 * `currentValue` — so the evaluator hands the numbers over as data rather than
 * baking them into the two prose strings `triggerData` used to carry.
 */
export interface GraphAlertFacts {
  graph: { id: string; name: string };
  metric: { label: string; seriesName: string };
  condition: { operator: string; threshold: number; timePeriodMinutes: number };
  currentValue: number;
  /** The window the metric was read over — deep-links land on the spike. */
  window: { start: Date; end: Date };
  occurredAt: Date;
  /**
   * Id of the alert's most recent incident row (open or resolved), null before
   * it has ever fired. Advances exactly once per delivered fire, so it keys the
   * per-recipient idempotency ledger: stable while one fire is being retried,
   * distinct once the next incident opens. See `graphAlertFireDigest`.
   */
  previousFireId: string | null;
}

export interface TriggerContext {
  trigger: Trigger;
  projects: Project[];
  triggerData: TriggerData[];
  projectSlug: string;
  /** The action handlers are only ever reached from `processCustomGraphTrigger`,
   *  so every dispatch they see is a graph alert and carries its facts. */
  graphAlert: GraphAlertFacts;
}

export interface TriggerResult {
  triggerId: string;
  status: "triggered" | "not_triggered" | "error" | "already_firing";
  message?: string;
  updatedAt?: number;
  totalFound?: number;
  value?: number;
  threshold?: number;
  operator?: string;
}
