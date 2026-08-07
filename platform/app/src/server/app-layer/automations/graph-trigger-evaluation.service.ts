/**
 * Shared evaluation handler for custom-graph threshold alerts
 * (ADR-034 Phase 5 + 8.1).
 *
 * Single canonical handler called by both graph-alert process-manager paths:
 *
 *   - the real-time activity subscriber, which reacts to trace/evaluation
 *     activity; and
 *   - the scheduled graph-alert sweep, which scans for no-data and
 *     firing-resolve absence cases the event-driven path cannot reach.
 *
 * The evaluation side (fetch trigger + graph, build TimeseriesInput, call
 * `analyticsService.getTimeseries(...)`, compute current value via
 * the same aggregation rules, apply `evaluateCustomGraphThreshold` /
 * `isNoDataPredicate`, insert / resolve `TriggerSent` with the
 * dedup pattern). The notify hop uses the Liquid pipeline —
 * `buildGraphAlertTemplateContext` +
 * `dispatchGraphAlertAction` — so per-trigger custom templates and
 * the alert-default Liquid templates both apply.
 *
 * Idempotent: a second call inside the debounce window sees the
 * already-open `TriggerSent` and skips the side-effect (only updates
 * `lastRunAt`).
 */

import {
  type SlackActionParams,
  slackDeliveryMethodOf,
} from "@langwatch/automations/providers/slack";
import { buildGraphAlertTemplateContext } from "@langwatch/automations/templating/templateContext";
import { createLogger } from "@langwatch/observability";
import type { CustomGraph, Project, Trigger } from "@prisma/client";
import type { CustomGraphInput } from "~/components/analytics/CustomGraph";
import type {
  SeriesInputType,
  TimeseriesInputType,
} from "~/server/analytics/registry";
import type { TimeseriesResult } from "~/server/analytics/types";
import { buildSeriesName } from "~/server/app-layer/analytics/repositories/_timeseries-row-parser";
import {
  aggregateSeriesValues,
  extractSeriesPoints,
} from "~/server/app-layer/analytics/series-points";
import {
  type GraphAlertDispatchInput,
  type GraphAlertDispatchResult,
  graphAlertFireDigest,
} from "~/server/app-layer/automations/dispatch/graphAlertActionDispatch";
import { decryptSlackBotToken } from "~/server/app-layer/automations/providers/slack/server";
import type { ActionParams } from "~/server/app-layer/automations/trigger.types";
import { DispatchError } from "~/server/event-sourcing/queues/dispatchError";
import {
  evaluateCustomGraphThreshold,
  isNoDataPredicate,
} from "./evaluate-custom-graph-threshold.service";
import type {
  GraphTriggerSentRepository,
  OpenGraphTriggerSent,
} from "./repositories/trigger.repository";
import { parseSeriesIndex } from "./seriesName";

const logger = createLogger("langwatch:graph-trigger-evaluation");

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
  | "skipped"
  /** The threshold was crossed but the notification reached nobody (no
   *  recipients, all unsubscribed, no Slack webhook). No incident is opened —
   *  see the `didSend` gate in `evaluateGraphTrigger`. */
  | "not_delivered";

export interface EvaluateGraphTriggerResult {
  triggerId: string;
  projectId: string;
  reason: GraphTriggerEvaluationReason;
  status: GraphTriggerEvaluationStatus;
  /** Skip reason / breach value diagnostics for logs and tests. */
  detail?: string;
  /** Current metric value; null when there were no buckets at all. */
  value?: number;
  /** Whether a provider call actually carried the alert to a customer. Only
   *  set on a breach that dispatched. */
  didSend?: boolean;
  /** Render errors a custom template hit and fell back from (ADR-036/037). */
  renderErrors?: string[];
  /** Variables a custom template referenced that the context did not supply. */
  missingVariables?: string[];
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

/** `series` entry as stored on a `CustomGraph` — see {@link StoredGraphConfig}. */
type StoredSeries = StoredGraphConfig["series"][number];

/**
 * Trigger existence + active + customGraphId guards — the first stage of
 * {@link evaluateGraphTrigger}. Split out so the orchestrator reads as a
 * pipeline of stages instead of a wall of early returns.
 */
async function resolveActiveGraphTrigger({
  deps,
  triggerId,
  projectId,
  reason,
}: {
  deps: GraphTriggerEvaluationDeps;
  triggerId: string;
  projectId: string;
  reason: GraphTriggerEvaluationReason;
}): Promise<
  | { ok: false; result: EvaluateGraphTriggerResult }
  | { ok: true; trigger: Trigger; customGraphId: string }
> {
  const trigger = await deps.loadTrigger({ triggerId, projectId });
  if (!trigger) {
    return {
      ok: false,
      result: skipped({
        triggerId,
        projectId,
        reason,
        detail: "trigger missing",
      }),
    };
  }
  if (!trigger.active) {
    return {
      ok: false,
      result: skipped({
        triggerId,
        projectId,
        reason,
        detail: "trigger inactive",
      }),
    };
  }
  const customGraphId = trigger.customGraphId;
  if (!customGraphId) {
    return {
      ok: false,
      result: skipped({
        triggerId,
        projectId,
        reason,
        detail: "trigger has no customGraphId",
      }),
    };
  }
  return { ok: true, trigger, customGraphId };
}

/**
 * Threshold/operator/timePeriod/seriesName extraction from `actionParams` —
 * the second stage of {@link evaluateGraphTrigger}.
 */
function resolveAlertParams({
  trigger,
  triggerId,
  projectId,
  reason,
}: {
  trigger: Trigger;
  triggerId: string;
  projectId: string;
  reason: GraphTriggerEvaluationReason;
}):
  | { ok: false; result: EvaluateGraphTriggerResult }
  | {
      ok: true;
      params: ActionParams;
      threshold: number;
      operator: string;
      timePeriod: number;
      seriesName: string;
    } {
  const params = (trigger.actionParams ?? {}) as unknown as ActionParams;
  const { threshold, operator, timePeriod, seriesName } = params;
  if (
    threshold === undefined ||
    operator === undefined ||
    timePeriod === undefined
  ) {
    return {
      ok: false,
      result: skipped({
        triggerId,
        projectId,
        reason,
        detail: "missing threshold / operator / timePeriod",
      }),
    };
  }
  if (!seriesName) {
    return {
      ok: false,
      result: skipped({
        triggerId,
        projectId,
        reason,
        detail: "missing seriesName",
      }),
    };
  }
  return { ok: true, params, threshold, operator, timePeriod, seriesName };
}

/**
 * Custom-graph lookup + series-index + series-config guards — the third
 * stage of {@link evaluateGraphTrigger}.
 */
async function resolveGraphSeries({
  deps,
  customGraphId,
  seriesName,
  triggerId,
  projectId,
  reason,
}: {
  deps: GraphTriggerEvaluationDeps;
  customGraphId: string;
  seriesName: string;
  triggerId: string;
  projectId: string;
  reason: GraphTriggerEvaluationReason;
}): Promise<
  | { ok: false; result: EvaluateGraphTriggerResult }
  | {
      ok: true;
      customGraph: CustomGraph;
      graphData: StoredGraphConfig;
      series: StoredSeries;
    }
> {
  const customGraph = await deps.loadCustomGraph({ customGraphId, projectId });
  if (!customGraph) {
    return {
      ok: false,
      result: skipped({
        triggerId,
        projectId,
        reason,
        detail: "graph not found",
      }),
    };
  }

  const graphData = customGraph.graph as unknown as StoredGraphConfig | null;
  if (!graphData?.series || graphData.series.length === 0) {
    return {
      ok: false,
      result: skipped({
        triggerId,
        projectId,
        reason,
        detail: "graph has no series",
      }),
    };
  }

  const seriesIndex = parseSeriesIndex(seriesName);
  if (
    Number.isNaN(seriesIndex) ||
    seriesIndex < 0 ||
    seriesIndex >= graphData.series.length
  ) {
    return {
      ok: false,
      result: skipped({
        triggerId,
        projectId,
        reason,
        detail: `series index ${seriesIndex} not in graph`,
      }),
    };
  }
  const series = graphData.series[seriesIndex];
  if (!series?.name || !series.metric || !series.aggregation) {
    return {
      ok: false,
      result: skipped({
        triggerId,
        projectId,
        reason,
        detail: "invalid series configuration",
      }),
    };
  }
  return { ok: true, customGraph, graphData, series };
}

/**
 * Queries the timeseries for the trigger's window and aggregates the
 * current + previous values — the fourth stage of {@link evaluateGraphTrigger}.
 * Pure data-gathering: no skip/guard outcomes, unlike the earlier stages.
 */
async function computeSeriesValues({
  projectId,
  series,
  graphData,
  filters,
  timePeriod,
  now,
  getTimeseries,
}: {
  projectId: string;
  series: StoredSeries;
  graphData: StoredGraphConfig;
  filters: CustomGraph["filters"];
  timePeriod: number;
  now: Date;
  getTimeseries: GraphTriggerEvaluationDeps["getTimeseries"];
}): Promise<{
  startDate: Date;
  endDate: Date;
  currentValue: number;
  previousValue: number | null;
  currentPoints: ReturnType<typeof extractSeriesPoints>;
  previousPoints: ReturnType<typeof extractSeriesPoints>;
}> {
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
    filters: (filters ?? {}) as Record<
      string,
      unknown
    > as TimeseriesInputType["filters"],
    series: [seriesInput],
    groupBy: graphData.groupBy as TimeseriesInputType["groupBy"],
    timeScale: graphData.timeScale ?? 60,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };

  const timeseriesResult = await getTimeseries(timeseriesInput);
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

  return {
    startDate,
    endDate,
    currentValue,
    previousValue,
    currentPoints,
    previousPoints,
  };
}

/**
 * Everything already known about a breach by the time notification dispatch
 * begins — assembled once in {@link evaluateGraphTrigger} and threaded
 * through {@link handleBreach}, {@link prepareBreachDispatch}, and
 * {@link buildBreachContext} so their signatures name one shared shape
 * instead of repeating this same field list four times.
 */
interface BreachEvaluationContext {
  trigger: Trigger;
  triggerId: string;
  projectId: string;
  customGraphId: string;
  customGraph: CustomGraph;
  series: StoredSeries;
  seriesName: string;
  params: ActionParams;
  operator: string;
  threshold: number;
  timePeriod: number;
  currentValue: number;
  previousValue: number | null;
  currentPoints: ReturnType<typeof extractSeriesPoints>;
  previousPoints: ReturnType<typeof extractSeriesPoints>;
  startDate: Date;
  endDate: Date;
  now: Date;
  reason: GraphTriggerEvaluationReason;
}

/**
 * ADR-041: a bot connection posts via the Web API (gated blocks render);
 * extract + decrypt the token here so the dispatch helper stays crypto-free.
 *
 * An unresolvable bot connection FAILS LOUD. Falling through to the webhook
 * branch would be worse than useless: bot params carry no `slackWebhook`, so
 * the dispatcher would log "no Slack webhook configured", report didSend
 * false, and the customer would never learn their alert is broken. A
 * non-retryable DispatchError dead-letters the row with an actionable signal.
 */
function resolveBotDestination(
  trigger: Trigger,
): { token: string; channel: string } | null {
  if (trigger.action !== "SEND_SLACK_MESSAGE") return null;
  const slackParams = (trigger.actionParams ?? {}) as SlackActionParams;
  if (slackDeliveryMethodOf(slackParams) !== "bot") return null;
  const token = decryptSlackBotToken(slackParams);
  const channel = slackParams.slackChannelId?.trim();
  if (!token || !channel) {
    throw new DispatchError({
      message: `Slack bot connection for alert "${trigger.name}" is missing its token or channel — the alert cannot be delivered.`,
      retryable: false,
    });
  }
  return { token, channel };
}

/**
 * Builds the alert template context for a breach — the assembled variable
 * surface the Liquid pipeline renders against (per-trigger custom templates
 * override the alert defaults inside the renderer itself).
 */
function buildBreachContext({
  deps,
  trigger,
  customGraphId,
  customGraph,
  series,
  seriesName,
  operator,
  threshold,
  timePeriod,
  currentValue,
  previousValue,
  currentPoints,
  previousPoints,
  startDate,
  endDate,
  now,
  reason,
  project,
}: {
  deps: GraphTriggerEvaluationDeps;
  project: Project;
} & BreachEvaluationContext): GraphAlertTemplateContext {
  const metricLabel = series.name ?? seriesName;
  return buildGraphAlertTemplateContext({
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
}

/**
 * Dispatches the breach notification and, on a thrown (as opposed to a
 * clean `didSend: false`) failure, rolls the open claim back for a
 * retryable error so a retry can re-claim — but keeps it for a terminal
 * error, so the outbox's open pre-check backs off instead of re-POSTing to
 * a dead receiver forever.
 */
async function dispatchBreachNotification({
  deps,
  trigger,
  triggerId,
  project,
  projectId,
  context,
  params,
  botDestination,
  customGraphId,
  previousFire,
  claim,
}: {
  deps: GraphTriggerEvaluationDeps;
  trigger: Trigger;
  triggerId: string;
  project: Project;
  projectId: string;
  context: GraphAlertTemplateContext;
  params: ActionParams;
  botDestination: { token: string; channel: string } | null;
  customGraphId: string;
  previousFire: { id: string } | null;
  claim: OpenGraphTriggerSent;
}): Promise<GraphAlertDispatchResult> {
  try {
    return await deps.notifier.dispatch({
      trigger,
      project,
      context,
      recipients: params.members ?? [],
      slackWebhook: params.slackWebhook ?? null,
      botDestination,
      fireDigest: graphAlertFireDigest({
        triggerId,
        customGraphId,
        previousFireId: previousFire?.id ?? null,
      }),
    });
  } catch (dispatchError) {
    // A terminal (non-retryable) failure means the endpoint is permanently
    // broken — keep the claim so the outbox retry's open pre-check backs
    // off as `already_firing` instead of re-POSTing to a dead receiver on
    // every subsequent evaluation (specs/automations/webhook-http-action.feature:148).
    // Only roll back for retryable/unknown errors, where a retry might
    // still succeed and must be allowed to re-claim.
    const isTerminal =
      dispatchError instanceof DispatchError && !dispatchError.retryable;
    if (!isTerminal) {
      try {
        await deps.triggerSent.deleteOpenClaim({ id: claim.id, projectId });
      } catch (cleanupError) {
        // Best-effort: the dispatch failure is the actionable signal; a
        // failed rollback must not mask it. The orphaned claim self-heals
        // when the metric recovers (markResolved frees the identity).
        logger.error(
          { triggerId, projectId, customGraphId, error: cleanupError },
          "Failed to roll back the open graph-alert claim after a dispatch failure — the alert may stay suppressed until the metric recovers",
        );
      }
    }
    throw dispatchError;
  }
}

/**
 * Everything {@link handleBreach} needs once it has decided to actually
 * dispatch: project load, context build, bot-destination resolution, and the
 * atomic open-incident claim — the part of the breached-threshold path
 * before the provider call. Split out so `handleBreach` itself reads as
 * "already-firing pre-check, then prepare, then dispatch, then result".
 */
async function prepareBreachDispatch({
  deps,
  trigger,
  triggerId,
  projectId,
  customGraphId,
  customGraph,
  series,
  seriesName,
  operator,
  threshold,
  timePeriod,
  currentValue,
  previousValue,
  currentPoints,
  previousPoints,
  startDate,
  endDate,
  now,
  reason,
}: { deps: GraphTriggerEvaluationDeps } & BreachEvaluationContext): Promise<
  | { ok: false; result: EvaluateGraphTriggerResult }
  | {
      ok: true;
      project: Project;
      context: GraphAlertTemplateContext;
      botDestination: { token: string; channel: string } | null;
      previousFire: { id: string } | null;
      claim: OpenGraphTriggerSent;
    }
> {
  const project = await deps.loadProject(projectId);
  if (!project) {
    return {
      ok: false,
      result: skipped({
        triggerId,
        projectId,
        reason,
        detail: "project not found",
      }),
    };
  }

  // ADR-034 Phase 8.1: build the alert template context and dispatch
  // through the Liquid pipeline. Per-trigger custom templates (the
  // four Trigger columns) override the alert defaults inside the
  // renderer; this layer only assembles the variable surface.
  const context = buildBreachContext({
    deps,
    trigger,
    customGraphId,
    customGraph,
    series,
    seriesName,
    operator,
    threshold,
    timePeriod,
    currentValue,
    previousValue,
    currentPoints,
    previousPoints,
    startDate,
    endDate,
    now,
    reason,
    project,
  });

  const botDestination = resolveBotDestination(trigger);

  // The alert's most recent incident (open or resolved) is its fire
  // generation — it keys the per-recipient idempotency ledger so an outbox
  // retry of THIS fire doesn't re-notify anyone the previous attempt reached.
  // There is no open incident on this branch, so this reads the last resolved
  // one (null on the alert's very first fire). Read BEFORE the claim so it
  // reflects the PREVIOUS incident, not the row we are about to open.
  const previousFire = await deps.triggerSent.findLatestForGraphAlert({
    triggerId,
    projectId,
    customGraphId,
  });

  // ADR-034 P1: atomically claim the open incident BEFORE any provider side
  // effect. `findOpenForGraphAlert` above is only a pre-check — two evaluators
  // can both pass it before either writes a row (traceId is NULL for graph
  // alerts, so `@@unique([triggerId, traceId])` can't guard them). The
  // single-column unique on `openIncidentKey` arbitrates the INSERT: the loser
  // gets null here and backs off WITHOUT dispatching, so a breach fans out at
  // most one notification. Bot-destination resolution above may throw, but it
  // is pure-local (no provider call) and runs before the claim, so an
  // unresolvable connection dead-letters without orphaning an open row.
  const claim = await deps.triggerSent.claimOpenForGraphAlert({
    triggerId,
    projectId,
    customGraphId,
  });
  if (!claim) {
    logger.debug(
      { triggerId, projectId, customGraphId },
      "Another evaluator already claimed this graph-alert fire — backing off without dispatching",
    );
    await deps.updateLastRunAt({ triggerId, projectId });
    return {
      ok: false,
      result: {
        triggerId,
        projectId,
        reason,
        status: "already_firing",
        value: currentValue,
      },
    };
  }

  return { ok: true, project, context, botDestination, previousFire, claim };
}

/**
 * The breached-threshold path of {@link evaluateGraphTrigger}: already-firing
 * pre-check, {@link prepareBreachDispatch}, dispatch (with rollback on a
 * thrown failure), and the not-delivered / fired result shapes. Called in
 * the exact order the inline branch used to run in.
 */
async function handleBreach(
  args: {
    deps: GraphTriggerEvaluationDeps;
    openTriggerSent: OpenGraphTriggerSent | null;
  } & BreachEvaluationContext,
): Promise<EvaluateGraphTriggerResult> {
  const { deps, openTriggerSent, triggerId, projectId, reason, currentValue } =
    args;
  if (openTriggerSent) {
    // Already firing — cheap pre-check only. Update lastRunAt, do not notify
    // again. Mirrors cron's `already_firing` branch. This avoids a doomed
    // INSERT on the common already-firing path; the claim's unique violation
    // below is the real guarantee.
    await deps.updateLastRunAt({ triggerId, projectId });
    return {
      triggerId,
      projectId,
      reason,
      status: "already_firing",
      value: currentValue,
    };
  }

  // `args` also carries `openTriggerSent`, which `prepareBreachDispatch`
  // doesn't declare — harmless, since it only reads the fields it needs.
  const prepared = await prepareBreachDispatch(args);
  if (!prepared.ok) return prepared.result;
  const { project, context, botDestination, previousFire, claim } = prepared;

  // A THROWN dispatch (provider/network failure, as opposed to a clean
  // `didSend: false`) must also roll the claim back before propagating:
  // the outbox retries the evaluation, and the retry's open pre-check
  // would see the orphaned claim and back off as `already_firing` —
  // silently dropping the notification forever (the same no-op-on-retry
  // trap the cadence path documents in `dispatcher.ts`). The per-recipient
  // ledger is keyed on the PREVIOUS fire's id, unaffected by this delete,
  // so a retry after a partial send still skips recipients already reached.
  const dispatchResult = await dispatchBreachNotification({
    deps,
    trigger: args.trigger,
    triggerId,
    project,
    projectId,
    context,
    params: args.params,
    botDestination,
    customGraphId: args.customGraphId,
    previousFire,
    claim,
  });

  // An alert that told nobody is not "currently firing". Leaving the claim
  // open would light the alert up in the UI, stamp a last-fired time, and —
  // worst of all — suppress every future notification until the metric
  // recovers, because `findOpenForGraphAlert` would keep returning this row.
  // Roll the claim back so the next evaluation can re-claim and re-dispatch.
  // The scheduled-report path gates `recordFire` on delivery for the same
  // reason (see `report-dispatch.ts`).
  if (!dispatchResult.didSend) {
    await deps.triggerSent.deleteOpenClaim({ id: claim.id, projectId });
    await deps.updateLastRunAt({ triggerId, projectId });
    return {
      triggerId,
      projectId,
      reason,
      status: "not_delivered",
      value: currentValue,
      detail: `threshold crossed but nothing was delivered on the ${dispatchResult.channel} channel`,
      didSend: false,
      renderErrors: dispatchResult.renderErrors,
      missingVariables: dispatchResult.missingVariables,
    };
  }

  // Delivered — the claim row IS the open incident (written before the send),
  // so there is nothing more to record. Just stamp lastRunAt, same order as
  // the cron (`addTriggersSent` then `updateAlert`).
  await deps.updateLastRunAt({ triggerId, projectId });

  return {
    triggerId,
    projectId,
    reason,
    status: "fired",
    value: currentValue,
    detail: noteIfNoData(args.operator, args.threshold),
    didSend: true,
    renderErrors: dispatchResult.renderErrors,
    missingVariables: dispatchResult.missingVariables,
  };
}

/**
 * The not-breached tail of {@link evaluateGraphTrigger}: resolve an open
 * incident if one exists, then stamp `lastRunAt` either way.
 */
async function resolveNotBreachedResult({
  deps,
  openTriggerSent,
  triggerId,
  projectId,
  reason,
  currentValue,
  now,
}: {
  deps: GraphTriggerEvaluationDeps;
  openTriggerSent: OpenGraphTriggerSent | null;
  triggerId: string;
  projectId: string;
  reason: GraphTriggerEvaluationReason;
  currentValue: number;
  now: Date;
}): Promise<EvaluateGraphTriggerResult> {
  if (openTriggerSent) {
    await markResolved({ deps, openTriggerSent, projectId, now });
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

/**
 * Runs the first three stages of {@link evaluateGraphTrigger} —
 * {@link resolveActiveGraphTrigger}, {@link resolveAlertParams}, and
 * {@link resolveGraphSeries} — in sequence, short-circuiting on the first
 * skip. Split out purely so the orchestrator doesn't carry all three guard
 * chains itself; the stages still run in the exact original order.
 */
async function resolveTriggerEvaluationContext({
  deps,
  triggerId,
  projectId,
  reason,
}: {
  deps: GraphTriggerEvaluationDeps;
  triggerId: string;
  projectId: string;
  reason: GraphTriggerEvaluationReason;
}): Promise<
  | { ok: false; result: EvaluateGraphTriggerResult }
  | {
      ok: true;
      trigger: Trigger;
      customGraphId: string;
      params: ActionParams;
      threshold: number;
      operator: string;
      timePeriod: number;
      seriesName: string;
      customGraph: CustomGraph;
      graphData: StoredGraphConfig;
      series: StoredSeries;
    }
> {
  const triggerContext = await resolveActiveGraphTrigger({
    deps,
    triggerId,
    projectId,
    reason,
  });
  if (!triggerContext.ok) return triggerContext;
  const { trigger, customGraphId } = triggerContext;

  const alertParams = resolveAlertParams({
    trigger,
    triggerId,
    projectId,
    reason,
  });
  if (!alertParams.ok) return alertParams;
  const { params, threshold, operator, timePeriod, seriesName } = alertParams;

  const graphSeries = await resolveGraphSeries({
    deps,
    customGraphId,
    seriesName,
    triggerId,
    projectId,
    reason,
  });
  if (!graphSeries.ok) return graphSeries;
  const { customGraph, graphData, series } = graphSeries;

  return {
    ok: true,
    trigger,
    customGraphId,
    params,
    threshold,
    operator,
    timePeriod,
    seriesName,
    customGraph,
    graphData,
    series,
  };
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
  const resolved = await resolveTriggerEvaluationContext({
    deps,
    triggerId,
    projectId,
    reason,
  });
  if (!resolved.ok) return resolved.result;
  const {
    trigger,
    customGraphId,
    params,
    threshold,
    operator,
    timePeriod,
    seriesName,
    customGraph,
    graphData,
    series,
  } = resolved;

  const now = deps.now();
  const seriesValues = await computeSeriesValues({
    projectId,
    series,
    graphData,
    filters: customGraph.filters,
    timePeriod,
    now,
    getTimeseries: deps.getTimeseries,
  });

  const { breached } = evaluateCustomGraphThreshold({
    value: seriesValues.currentValue,
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
    return handleBreach({
      deps,
      openTriggerSent,
      trigger,
      triggerId,
      projectId,
      customGraphId,
      customGraph,
      series,
      seriesName,
      params,
      operator,
      threshold,
      timePeriod,
      now,
      reason,
      ...seriesValues,
    });
  }

  // Not breached.
  return resolveNotBreachedResult({
    deps,
    openTriggerSent,
    triggerId,
    projectId,
    reason,
    currentValue: seriesValues.currentValue,
    now,
  });
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
