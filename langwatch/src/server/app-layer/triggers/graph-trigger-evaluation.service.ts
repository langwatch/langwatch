/**
 * Shared evaluation handler for custom-graph threshold alerts
 * (ADR-034 Phase 5).
 *
 * Single canonical handler called by BOTH:
 *
 *   - the real-time outbox reactor on the trace-processing pipeline
 *     (`graphTriggerEvaluation.outboxReactor.ts`), which decides on every
 *     `traceAnalytics` fold update; and
 *   - the heartbeat (`graph-trigger-heartbeat.ts`), which scans for
 *     no-data / firing-resolve absence cases the event-driven path
 *     structurally cannot reach.
 *
 * Mirrors the cron's `processCustomGraphTrigger` exactly:
 *
 *   - Fetch trigger, custom graph, build TimeseriesInput, call
 *     `analyticsService.getTimeseries(...)` (which routes to slim /
 *     rollup / legacy via ADR-034 Phase 3 automatically).
 *   - Compute current value via the same aggregation rules
 *     (`sum/average/cardinality/...`).
 *   - Apply `evaluateCustomGraphThreshold` (the extracted pure
 *     function the cron also calls).
 *   - Apply `isNoDataPredicate` to recognise the "fire when zero" shape.
 *   - On breach: insert a `TriggerSent` row (cron's EXACT dedup pattern
 *     — `triggerId/projectId/customGraphId, resolvedAt:null`) and
 *     dispatch via existing `handleSendEmail` / `handleSendSlackMessage`
 *     (which now pick the alert-default template since `customGraphId`
 *     is set).
 *   - On no-longer-breach: resolve any open `TriggerSent` for the
 *     trigger.
 *
 * Idempotent: a second call inside the debounce window sees the
 * already-open `TriggerSent` and skips the side-effect (only updates
 * `lastRunAt`).
 */

import type {
  CustomGraph,
  Project,
  Trigger,
  TriggerAction as TriggerActionEnum,
} from "@prisma/client";
import type { CustomGraphInput } from "~/components/analytics/CustomGraph";
import { sumMetricAcrossGroups } from "~/pages/api/cron/triggers/customGraphTrigger";
import type {
  ActionParams,
  TriggerData,
} from "~/pages/api/cron/triggers/types";
import type {
  SeriesInputType,
  TimeseriesInputType,
} from "~/server/analytics/registry";
import type {
  TimeseriesBucket,
  TimeseriesResult,
} from "~/server/analytics/types";
import type { Trace } from "~/server/tracer/types";
import {
  evaluateCustomGraphThreshold,
  isNoDataPredicate,
} from "./evaluate-custom-graph-threshold.service";
import type {
  GraphTriggerSentRepository,
  OpenGraphTriggerSent,
} from "./repositories/trigger.repository";

/**
 * What woke the evaluator up. Carried into logs + telemetry so operators can
 * tell whether a fire came from the event-driven path (real-time fold update)
 * or one of the heartbeat absence checks. Does NOT change behaviour — the
 * threshold + no-data + dedup logic is the same regardless.
 */
export type GraphTriggerEvaluationReason =
  | "real-time"
  | "heartbeat-absence"
  | "heartbeat-resolve";

export type GraphTriggerEvaluationStatus =
  | "fired"
  | "already_firing"
  | "resolved"
  | "not_breached"
  | "skipped";

export interface EvaluateGraphTriggerResult {
  triggerId: string;
  projectId: string;
  reason: GraphTriggerEvaluationReason;
  status: GraphTriggerEvaluationStatus;
  /** Skip reason / breach value diagnostics for logs and tests. */
  detail?: string;
  /** Current metric value; null when there were no buckets at all. */
  value?: number;
}

export type StoredGraphConfig = Pick<
  CustomGraphInput,
  "series" | "groupBy" | "groupByKey" | "timeScale"
>;

/**
 * Notification dispatcher contract. Implemented in the wiring layer by
 * the EXISTING `handleSendEmail` / `handleSendSlackMessage` from
 * `~/pages/api/cron/triggers/actions/` — the same handlers the cron uses.
 * Kept as injected hooks here so this service stays free of mailer /
 * Slack dependencies and easy to unit-test.
 */
export interface GraphTriggerNotifier {
  sendEmail(params: {
    trigger: Trigger;
    projects: Project[];
    triggerData: TriggerData[];
    projectSlug: string;
  }): Promise<void>;
  sendSlack(params: {
    trigger: Trigger;
    projects: Project[];
    triggerData: TriggerData[];
    projectSlug: string;
  }): Promise<void>;
}

export interface GraphTriggerEvaluationDeps {
  loadTrigger(params: {
    triggerId: string;
    projectId: string;
  }): Promise<Trigger | null>;
  loadCustomGraph(params: {
    customGraphId: string;
    projectId: string;
  }): Promise<CustomGraph | null>;
  loadProject(projectId: string): Promise<Project | null>;
  getTimeseries(input: TimeseriesInputType): Promise<TimeseriesResult>;
  triggerSent: GraphTriggerSentRepository;
  updateLastRunAt(params: {
    triggerId: string;
    projectId: string;
  }): Promise<void>;
  notifier: GraphTriggerNotifier;
  now(): Date;
}

/**
 * Evaluate (and possibly fire / resolve) one custom-graph trigger.
 *
 * Returns a typed result so callers can plumb telemetry. Throws only
 * on genuine infrastructure errors; soft failures (trigger missing,
 * graph missing, no series) return a `skipped` result.
 */
export async function evaluateGraphTrigger({
  deps,
  triggerId,
  projectId,
  reason,
}: {
  deps: GraphTriggerEvaluationDeps;
  triggerId: string;
  projectId: string;
  reason: GraphTriggerEvaluationReason;
}): Promise<EvaluateGraphTriggerResult> {
  const trigger = await deps.loadTrigger({ triggerId, projectId });
  if (!trigger) {
    return skipped({ triggerId, projectId, reason, detail: "trigger missing" });
  }
  if (!trigger.active) {
    return skipped({
      triggerId,
      projectId,
      reason,
      detail: "trigger inactive",
    });
  }
  const customGraphId = trigger.customGraphId;
  if (!customGraphId) {
    return skipped({
      triggerId,
      projectId,
      reason,
      detail: "trigger has no customGraphId",
    });
  }

  const params = (trigger.actionParams ?? {}) as unknown as ActionParams;
  const threshold = params.threshold;
  const operator = params.operator;
  const timePeriod = params.timePeriod;
  const seriesName = params.seriesName;
  if (
    threshold === undefined ||
    operator === undefined ||
    timePeriod === undefined
  ) {
    return skipped({
      triggerId,
      projectId,
      reason,
      detail: "missing threshold / operator / timePeriod",
    });
  }
  if (!seriesName) {
    return skipped({
      triggerId,
      projectId,
      reason,
      detail: "missing seriesName",
    });
  }

  const customGraph = await deps.loadCustomGraph({ customGraphId, projectId });
  if (!customGraph) {
    return skipped({ triggerId, projectId, reason, detail: "graph not found" });
  }

  const graphData = customGraph.graph as unknown as StoredGraphConfig | null;
  if (!graphData?.series || graphData.series.length === 0) {
    return skipped({
      triggerId,
      projectId,
      reason,
      detail: "graph has no series",
    });
  }

  // seriesName format: "index/key/aggregation" — same parsing as cron.
  const [indexStr] = seriesName.split("/");
  const seriesIndex = Number.parseInt(indexStr ?? "0", 10);
  if (
    Number.isNaN(seriesIndex) ||
    seriesIndex < 0 ||
    seriesIndex >= graphData.series.length
  ) {
    return skipped({
      triggerId,
      projectId,
      reason,
      detail: `series index ${seriesIndex} not in graph`,
    });
  }
  const series = graphData.series[seriesIndex];
  if (!series?.name || !series.metric || !series.aggregation) {
    return skipped({
      triggerId,
      projectId,
      reason,
      detail: "invalid series configuration",
    });
  }

  const now = deps.now();
  const endDate = now;
  const startDate = new Date(endDate.getTime() - timePeriod * 60 * 1000);

  const seriesInput: SeriesInputType = {
    metric: series.metric as SeriesInputType["metric"],
    aggregation: series.aggregation as SeriesInputType["aggregation"],
    key: series.key,
    subkey: series.subkey,
    pipeline: series.pipeline as SeriesInputType["pipeline"],
    filters: series.filters as SeriesInputType["filters"],
    asPercent: series.asPercent,
  };
  const timeseriesInput: TimeseriesInputType = {
    projectId,
    startDate: startDate.getTime(),
    endDate: endDate.getTime(),
    filters: (customGraph.filters ?? {}) as Record<
      string,
      unknown
    > as TimeseriesInputType["filters"],
    series: [seriesInput],
    groupBy: graphData.groupBy as TimeseriesInputType["groupBy"],
    timeScale: graphData.timeScale ?? 60,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };

  const timeseriesResult = await deps.getTimeseries(timeseriesInput);
  const currentValue = calculateCurrentValue(
    timeseriesResult,
    series,
    seriesName,
    graphData.groupBy,
  );

  const { breached } = evaluateCustomGraphThreshold({
    value: currentValue,
    threshold,
    operator,
  });
  // `breached` already covers no-data triggers (value=0 vs `lt 1` etc.);
  // `isNoDataPredicate` is kept here as the operator-intent marker the
  // heartbeat caller uses to decide which triggers to even consider.

  const openTriggerSent = await deps.triggerSent.findOpenForGraphAlert({
    triggerId,
    projectId,
    customGraphId,
  });

  if (breached) {
    if (openTriggerSent) {
      // Already firing — only update lastRunAt, do not notify again.
      // Mirrors cron's `already_firing` branch.
      await deps.updateLastRunAt({ triggerId, projectId });
      return {
        triggerId,
        projectId,
        reason,
        status: "already_firing",
        value: currentValue,
      };
    }

    const project = await deps.loadProject(projectId);
    if (!project) {
      return skipped({
        triggerId,
        projectId,
        reason,
        detail: "project not found",
      });
    }

    const triggerData: TriggerData[] = [
      {
        input: `Graph: ${customGraph.name}`,
        output: `Current value: ${currentValue.toFixed(
          2,
        )} (threshold: ${operator} ${threshold})`,
        graphId: customGraphId,
        projectId,
        fullTrace: {} as Trace,
      },
    ];

    const dispatchedTrigger: Trigger = {
      ...trigger,
      message:
        trigger.message ??
        `Graph "${customGraph.name}" alert: Value ${currentValue.toFixed(
          2,
        )} ${operator} ${threshold}`,
    };

    if (isSendEmail(trigger.action)) {
      await deps.notifier.sendEmail({
        trigger: dispatchedTrigger,
        projects: [project],
        triggerData,
        projectSlug: project.slug,
      });
    } else if (isSendSlack(trigger.action)) {
      await deps.notifier.sendSlack({
        trigger: dispatchedTrigger,
        projects: [project],
        triggerData,
        projectSlug: project.slug,
      });
    }

    // Record the fire BEFORE updateLastRunAt — same order as the cron
    // (`addTriggersSent` then `updateAlert`).
    await deps.triggerSent.createOpenForGraphAlert({
      triggerId,
      projectId,
      customGraphId,
    });
    await deps.updateLastRunAt({ triggerId, projectId });

    return {
      triggerId,
      projectId,
      reason,
      status: "fired",
      value: currentValue,
      detail: noteIfNoData(operator, threshold),
    };
  }

  // Not breached.
  if (openTriggerSent) {
    await markResolved({
      deps,
      openTriggerSent,
      projectId,
      now,
    });
    await deps.updateLastRunAt({ triggerId, projectId });
    return {
      triggerId,
      projectId,
      reason,
      status: "resolved",
      value: currentValue,
    };
  }
  await deps.updateLastRunAt({ triggerId, projectId });
  return {
    triggerId,
    projectId,
    reason,
    status: "not_breached",
    value: currentValue,
  };
}

async function markResolved({
  deps,
  openTriggerSent,
  projectId,
  now,
}: {
  deps: GraphTriggerEvaluationDeps;
  openTriggerSent: OpenGraphTriggerSent;
  projectId: string;
  now: Date;
}): Promise<void> {
  await deps.triggerSent.markResolvedById({
    id: openTriggerSent.id,
    projectId,
    now,
  });
}

function skipped({
  triggerId,
  projectId,
  reason,
  detail,
}: {
  triggerId: string;
  projectId: string;
  reason: GraphTriggerEvaluationReason;
  detail: string;
}): EvaluateGraphTriggerResult {
  return { triggerId, projectId, reason, status: "skipped", detail };
}

function noteIfNoData(operator: string, threshold: number): string | undefined {
  return isNoDataPredicate({ operator, threshold })
    ? "no-data predicate"
    : undefined;
}

function isSendEmail(action: TriggerActionEnum): boolean {
  return action === "SEND_EMAIL";
}

function isSendSlack(action: TriggerActionEnum): boolean {
  return action === "SEND_SLACK_MESSAGE";
}

/**
 * Mirror of cron's `calculateCurrentValue`
 * (src/pages/api/cron/triggers/customGraphTrigger.ts:340-382).
 * Kept here, NOT re-exported from the cron file, because the cron file
 * is a Next.js page module and the spec asks for the eval logic to
 * live in the app layer. Pure-function form for unit testing.
 */
function calculateCurrentValue(
  timeseriesResult: TimeseriesResult,
  series: CustomGraphInput["series"][number],
  seriesKey: string,
  groupBy?: string,
): number {
  const dataPoints = timeseriesResult.currentPeriod;
  if (dataPoints.length === 0) return 0;

  const values: number[] = [];
  for (const entry of dataPoints as TimeseriesBucket[]) {
    const direct = entry[seriesKey];
    if (typeof direct === "number") {
      values.push(direct);
      continue;
    }
    if (groupBy) {
      const grouped = sumMetricAcrossGroups(entry, groupBy, seriesKey);
      if (typeof grouped === "number") {
        values.push(grouped);
        continue;
      }
    }
    values.push(0);
  }
  if (values.length === 0) return 0;

  const aggregation = series.aggregation as string;
  if (
    aggregation === "cardinality" ||
    aggregation === "terms" ||
    aggregation === "count"
  ) {
    return values.reduce((a, b) => a + b, 0);
  }
  return values.reduce((a, b) => a + b, 0) / values.length;
}
