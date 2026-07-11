/**
 * Shared evaluation handler for custom-graph threshold alerts
 * (ADR-034 Phase 5 + 8.1).
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
 * Mirrors the cron's `processCustomGraphTrigger` for the evaluation
 * side (fetch trigger + graph, build TimeseriesInput, call
 * `analyticsService.getTimeseries(...)`, compute current value via
 * the same aggregation rules, apply `evaluateCustomGraphThreshold` /
 * `isNoDataPredicate`, insert / resolve `TriggerSent` with the same
 * dedup pattern). Phase 8.1 replaces the cron's hardcoded
 * `handleSendEmail` / `handleSendSlackMessage` notify hop with the
 * Liquid pipeline — `buildGraphAlertTemplateContext` +
 * `dispatchGraphAlertAction` — so per-trigger custom templates and
 * the alert-default Liquid templates both apply.
 *
 * Idempotent: a second call inside the debounce window sees the
 * already-open `TriggerSent` and skips the side-effect (only updates
 * `lastRunAt`).
 */

import type { CustomGraph, Project, Trigger } from "@prisma/client";
import type { CustomGraphInput } from "~/components/analytics/CustomGraph";
import type { ActionParams } from "~/pages/api/cron/triggers/types";
import { decryptSlackBotToken } from "~/automations/providers/definitions/slack/secret";
import {
  type SlackActionParams,
  slackDeliveryMethodOf,
} from "~/automations/providers/definitions/slack/shared";
import { buildSeriesName } from "~/server/app-layer/analytics/repositories/_timeseries-row-parser";
import {
  aggregateSeriesValues,
  extractSeriesPoints,
} from "~/server/app-layer/analytics/series-points";
import type {
  SeriesInputType,
  TimeseriesInputType,
} from "~/server/analytics/registry";
import type { TimeseriesResult } from "~/server/analytics/types";
import type {
  GraphAlertDispatchInput,
  GraphAlertDispatchResult,
} from "~/server/event-sourcing/pipelines/shared/graphAlertActionDispatch";
import { buildGraphAlertTemplateContext } from "~/shared/templating/templateContext";
import {
  evaluateCustomGraphThreshold,
  isNoDataPredicate,
} from "./evaluate-custom-graph-threshold.service";
import type {
  GraphTriggerSentRepository,
  OpenGraphTriggerSent,
} from "./repositories/trigger.repository";
import { parseSeriesIndex } from "./seriesName";

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
 * Notification dispatcher hook (ADR-034 Phase 8.1). Implemented in the
 * wiring layer by `dispatchGraphAlertAction` — which routes through the
 * Liquid pipeline + per-trigger custom templates + alert defaults.
 * Kept as an injected hook here so this service stays free of mailer /
 * Slack / templating dependencies and trivially unit-testable.
 */
export interface GraphTriggerNotifier {
  dispatch(input: GraphAlertDispatchInput): Promise<GraphAlertDispatchResult>;
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
  /** Base host for building deep links inside rendered templates
   *  (ADR-034 Phase 8.1). Injected, not read from env, so this service
   *  stays pure and testable. */
  baseHost: string;
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

  const seriesIndex = parseSeriesIndex(seriesName);
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
  // The stored `seriesName` identifies WHICH series the trigger watches
  // (`{index}/{key|metric}/{aggregation}` — parsed above via
  // `parseSeriesIndex`). Result buckets use a DIFFERENT encoding —
  // `buildSeriesName`: `{queryIndex}/{metric}/{agg}[/{key}]` with terms→
  // cardinality — and we query a single-series input, so the bucket key is
  // always derived from `seriesInput` at index 0. Passing the stored
  // identifier straight through only matched for a first-position, keyless,
  // non-terms series; everything else silently read 0.
  const bucketKey = buildSeriesName(seriesInput, 0);
  const currentPoints = extractSeriesPoints(
    timeseriesResult.currentPeriod,
    bucketKey,
    graphData.groupBy,
  );
  const previousPoints = extractSeriesPoints(
    timeseriesResult.previousPeriod,
    bucketKey,
    graphData.groupBy,
  );
  const currentValue = aggregateSeriesValues(
    currentPoints.map((point) => point.value),
    series.aggregation as string,
    timeseriesResult.currentPeriod.length,
  );
  const previousValue =
    timeseriesResult.previousPeriod.length === 0
      ? null
      : aggregateSeriesValues(
          previousPoints.map((point) => point.value),
          series.aggregation as string,
          timeseriesResult.previousPeriod.length,
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

    // ADR-034 Phase 8.1: build the alert template context and dispatch
    // through the Liquid pipeline. Per-trigger custom templates (the
    // four Trigger columns) override the alert defaults inside the
    // renderer; this layer only assembles the variable surface.
    const metricLabel = series.name ?? seriesName;
    const context = buildGraphAlertTemplateContext({
      trigger: {
        id: trigger.id,
        name: trigger.name,
        alertType: trigger.alertType,
      },
      graph: { id: customGraphId, name: customGraph.name },
      metric: { label: metricLabel, seriesName },
      condition: {
        operator,
        threshold,
        timePeriodMinutes: timePeriod,
      },
      currentValue,
      previousValue,
      // Chronological metric history (previous window + alert window) so
      // templates can render the trend — the prebuilt `sparkline` or the
      // raw `history` points. Same buckets the threshold read; no extra
      // query.
      history: [...previousPoints, ...currentPoints],
      window: { start: startDate, end: endDate },
      occurredAt: now,
      reason,
      project: { id: project.id, name: project.name, slug: project.slug },
      baseHost: deps.baseHost,
    });

    // ADR-041: a bot connection posts via the Web API (gated blocks render);
    // extract + decrypt the token here so the dispatch helper stays crypto-free.
    const slackParams = (trigger.actionParams ?? {}) as SlackActionParams;
    let botDestination: { token: string; channel: string } | null = null;
    if (slackDeliveryMethodOf(slackParams) === "bot") {
      const token = decryptSlackBotToken(slackParams);
      const channel = slackParams.slackChannelId?.trim();
      if (token && channel) botDestination = { token, channel };
    }

    await deps.notifier.dispatch({
      trigger,
      project,
      context,
      recipients: params.members ?? [],
      slackWebhook: params.slackWebhook ?? null,
      botDestination,
    });

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

