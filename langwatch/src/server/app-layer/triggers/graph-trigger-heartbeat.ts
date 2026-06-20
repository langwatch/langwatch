/**
 * ADR-034 Phase 5 — heartbeat path for custom-graph threshold alerts.
 *
 * Registered as an `OutboxHeartbeatRegistry` entry that ticks every
 * 30 seconds (the locked Phase 5 cadence). Worker-only at runtime; the
 * scheduler no-ops on web. Every tick:
 *
 *   1. For each project with `release_es_graph_triggers_firing` ON,
 *      load (a) active triggers whose operator/threshold combination
 *      matches `isNoDataPredicate`, plus (b) active triggers with at
 *      least one unresolved `TriggerSent` row. Union = candidates.
 *   2. Pre-filter (LOCKED by the Phase 5 spec): one batched
 *      `max(OccurredAt)` query against the slim `trace_analytics`
 *      table per project per tick — bounded by `max(windowMs)` across
 *      that project's candidates. For each candidate, if the project's
 *      most recent qualifying event is older than the candidate's own
 *      window (or NULL), enqueue. If it is recent enough, the
 *      real-time reactor is already handling that trigger, so skip.
 *   3. Return one `OutboxEnqueueRequest` per surviving candidate; the
 *      heartbeat scheduler routes them through `dispatchOutboxEnqueues`,
 *      same path the event-driven reactor uses.
 *
 * The heartbeat does NOT re-enqueue every active trigger every tick —
 * only the absence cases the event-driven path cannot reach. The
 * shared evaluator handler picks the actual `fired` / `resolved` /
 * `not_breached` outcome from the analytics data.
 */

import type { PrismaClient } from "@prisma/client";
import type { ClickHouseClientResolver } from "~/server/clickhouse/clickhouseClient";
import { getClickHouseClientForProject } from "~/server/clickhouse/clickhouseClient";
import { prisma as defaultPrisma } from "~/server/db";
import { outboxHeartbeatRegistry } from "~/server/event-sourcing/outbox/heartbeat";
import type { OutboxEnqueueRequest } from "~/server/event-sourcing/outbox/outboxReactor.types";
import {
  GRAPH_TRIGGER_EVAL_REACTOR_NAME,
  graphEvalDedupId,
  graphEvalGroupKey,
  type GraphEvalStagePayload,
} from "~/server/event-sourcing/outbox/payload";
import { featureFlagService as defaultFeatureFlagService } from "~/server/featureFlag";
import type { FeatureFlagServiceInterface } from "~/server/featureFlag/types";
import type { ActionParams } from "~/pages/api/cron/triggers/types";
import { createLogger } from "~/utils/logger/server";
import {
  type AnalyticsMetricSource,
  getMetricSource,
} from "~/server/app-layer/analytics/routing/field-availability";
import { isNoDataPredicate } from "./evaluate-custom-graph-threshold.service";
import type { TriggerService } from "./trigger.service";

const logger = createLogger("langwatch:app-layer:triggers:graph-trigger-heartbeat");

export const GRAPH_TRIGGER_HEARTBEAT_NAME = "graphTriggerHeartbeat" as const;
export const GRAPH_TRIGGER_HEARTBEAT_INTERVAL_MS = 30_000;

interface CandidateTrigger {
  triggerId: string;
  projectId: string;
  windowMs: number;
  /** "absence" = no-data shape; "resolve" = firing-resolve when traffic stops. */
  reasonKind: "absence" | "resolve";
  /**
   * ADR-034 Phase 6 source-awareness: the upstream pipeline whose slim
   * table the heartbeat queries for recency. `"trace"` candidates query
   * `trace_analytics`; `"evaluation"` candidates query
   * `evaluation_analytics`. Unknown-source candidates default to `"trace"`
   * (preserves the pre-Phase-6 behaviour).
   */
  source: AnalyticsMetricSource;
}

export interface GraphTriggerHeartbeatDeps {
  triggers: TriggerService;
  prisma: PrismaClient;
  /** Resolver matching the slim repository's contract — same signature so
   *  tests can stub a single client and the prod path uses the default
   *  per-project resolver. */
  resolveClickHouseClient: ClickHouseClientResolver;
  featureFlagService: FeatureFlagServiceInterface;
  /**
   * ADR-034 Phase 6: look up the upstream pipeline source for a graph
   * trigger by reading its underlying custom-graph's first series'
   * metric key. Returns `undefined` when the source can't be
   * determined (graph missing, metric not in field-availability) — the
   * heartbeat treats those as `"trace"` so behaviour is unchanged for
   * unknown-source triggers (the cron has always handled them).
   */
  lookupTriggerSource(params: {
    triggerId: string;
    customGraphId: string;
    projectId: string;
  }): Promise<AnalyticsMetricSource | undefined>;
}

export interface HeartbeatCandidateSources {
  /** Project ids with `release_es_graph_triggers_firing` ON. The
   *  heartbeat must NOT bombard the operator-flag table — the
   *  cron-equivalent project read covers this in one query. */
  loadProjectsWithGraphTriggers(): Promise<string[]>;
  /** Project ids that have at least one unresolved graph-alert
   *  `TriggerSent` (the "resolve-when-traffic-stops" candidate set).
   *  Returns a Set so the heartbeat can intersect cheaply with the
   *  flagged-projects set. */
  loadProjectsWithOpenGraphTriggerSent(): Promise<Set<string>>;
}

/**
 * One project's slim-table recency snapshot per source. `lastOccurredAtMs`
 * is `null` when the project has no qualifying event in the bounding
 * window — that's the no-data-fire case in its entirety.
 */
interface ProjectRecency {
  projectId: string;
  source: AnalyticsMetricSource;
  lastOccurredAtMs: number | null;
}

/** Min window so the heartbeat doesn't issue a degenerate `now - 0` filter. */
const MIN_BOUND_WINDOW_MS = 60_000;

/** Slim table name per source (ADR-034 Phase 6). */
const SLIM_TABLE_BY_SOURCE: Record<AnalyticsMetricSource, string> = {
  trace: "trace_analytics",
  evaluation: "evaluation_analytics",
};

/** Aggregate-id column per source. The IN-tuple dedup pattern uses this
 *  as the (TenantId, <id>, UpdatedAt) grouping key for the slim
 *  `ReplacingMergeTree(UpdatedAt)` table. */
const SLIM_AGGREGATE_ID_COLUMN_BY_SOURCE: Record<
  AnalyticsMetricSource,
  string
> = {
  trace: "TraceId",
  evaluation: "EvaluationId",
};

/**
 * Register the graph-trigger heartbeat with the process-singleton
 * registry. Idempotent on `name` — re-registration throws (so a
 * second worker boot fails loud rather than silently shadowing).
 *
 * Worker-only at RUNTIME (the scheduler `start()`s only on workers),
 * but registration is passive data so it's safe to call this from any
 * process role. Returns the registered definition so callers can keep
 * a reference for tests / shutdown.
 */
export function registerGraphTriggerHeartbeat(deps: GraphTriggerHeartbeatDeps): {
  name: typeof GRAPH_TRIGGER_HEARTBEAT_NAME;
} {
  const sources = defaultCandidateSources(deps.prisma);
  outboxHeartbeatRegistry.register({
    name: GRAPH_TRIGGER_HEARTBEAT_NAME,
    intervalMs: GRAPH_TRIGGER_HEARTBEAT_INTERVAL_MS,
    decide: ({ now }) =>
      decideGraphTriggerHeartbeat({
        deps,
        sources,
        now,
      }),
  });
  return { name: GRAPH_TRIGGER_HEARTBEAT_NAME };
}

/**
 * Default candidate-source implementation reading Prisma directly.
 * Exposed for tests via dependency injection at decide time.
 */
function defaultCandidateSources(
  prisma: PrismaClient,
): HeartbeatCandidateSources {
  return {
    loadProjectsWithGraphTriggers: async () => {
      const rows = await prisma.trigger.findMany({
        where: {
          active: true,
          deleted: false,
          customGraphId: { not: null },
        },
        select: { projectId: true },
        distinct: ["projectId"],
      });
      return rows.map((r) => r.projectId);
    },
    loadProjectsWithOpenGraphTriggerSent: async () => {
      const rows = await prisma.triggerSent.findMany({
        where: {
          resolvedAt: null,
          customGraphId: { not: null },
        },
        select: { projectId: true },
        distinct: ["projectId"],
      });
      return new Set(rows.map((r) => r.projectId));
    },
  };
}

/**
 * Pure heartbeat `decide` (no I/O outside its injected deps). Exported
 * so tests can drive it directly without going through the registry.
 */
export async function decideGraphTriggerHeartbeat({
  deps,
  sources,
  now,
}: {
  deps: GraphTriggerHeartbeatDeps;
  sources: HeartbeatCandidateSources;
  now: Date;
}): Promise<OutboxEnqueueRequest[]> {
  // Step 1: load the union of "has graph triggers" + "has open sent"
  // projects, then intersect with flag-ON projects.
  const [graphProjects, openSentProjects] = await Promise.all([
    sources.loadProjectsWithGraphTriggers(),
    sources.loadProjectsWithOpenGraphTriggerSent(),
  ]);
  const projectIds = Array.from(
    new Set<string>([...graphProjects, ...openSentProjects]),
  );

  const flaggedProjects: string[] = [];
  for (const projectId of projectIds) {
    const enabled = await deps.featureFlagService.isEnabled(
      "release_es_graph_triggers_firing",
      { distinctId: projectId, projectId },
    );
    if (enabled) flaggedProjects.push(projectId);
  }
  if (flaggedProjects.length === 0) return [];

  const requests: OutboxEnqueueRequest[] = [];
  for (const projectId of flaggedProjects) {
    const candidates = await loadCandidatesForProject({
      deps,
      projectId,
      hasOpenSent: openSentProjects.has(projectId),
    });
    if (candidates.length === 0) continue;

    // Step 2: per-project, per-source pre-filter — ONE batched slim
    // query per (project, source) per tick (at most 2 queries per
    // project per tick: one against `trace_analytics`, one against
    // `evaluation_analytics`). If the project's recent qualifying
    // activity for the trigger's source is fresher than the
    // candidate's window, the real-time path is already handling it
    // and we skip the enqueue.
    const candidatesBySource = groupCandidatesBySource(candidates);
    const recencyBySource = new Map<AnalyticsMetricSource, ProjectRecency>();
    for (const [source, sourceCandidates] of candidatesBySource.entries()) {
      const boundMs = Math.max(...sourceCandidates.map((c) => c.windowMs));
      const recency = await loadProjectRecency({
        deps,
        projectId,
        source,
        boundWindowMs: Math.max(MIN_BOUND_WINDOW_MS, boundMs),
        now,
      });
      recencyBySource.set(source, recency);
    }

    for (const candidate of candidates) {
      const recency = recencyBySource.get(candidate.source);
      if (!recency) continue;
      const cutoff = now.getTime() - candidate.windowMs;
      if (
        recency.lastOccurredAtMs !== null &&
        recency.lastOccurredAtMs > cutoff
      ) {
        // Real-time path is firing for this trigger; skip.
        continue;
      }
      const reason: GraphEvalStagePayload["reason"] =
        candidate.reasonKind === "absence"
          ? "heartbeat-absence"
          : "heartbeat-resolve";
      const payload: GraphEvalStagePayload = {
        stage: "graphEval",
        projectId,
        triggerId: candidate.triggerId,
        reactorName: GRAPH_TRIGGER_EVAL_REACTOR_NAME,
        reason,
      };
      requests.push({
        dedupKey: graphEvalDedupId({
          projectId,
          triggerId: candidate.triggerId,
          suffix: "hb",
        }),
        groupKey: graphEvalGroupKey({
          projectId,
          triggerId: candidate.triggerId,
        }),
        payload: payload as unknown as OutboxEnqueueRequest["payload"],
        enqueueOptions: { ttlMs: GRAPH_TRIGGER_HEARTBEAT_INTERVAL_MS },
      });
    }
  }

  if (requests.length > 0) {
    logger.info(
      { count: requests.length },
      "graphTriggerHeartbeat enqueueing absence/resolve evaluations",
    );
  }
  return requests;
}

async function loadCandidatesForProject({
  deps,
  projectId,
  hasOpenSent,
}: {
  deps: GraphTriggerHeartbeatDeps;
  projectId: string;
  hasOpenSent: boolean;
}): Promise<CandidateTrigger[]> {
  const triggers =
    await deps.triggers.getActiveGraphTriggersForProject(projectId);
  if (triggers.length === 0) return [];

  const openIds = hasOpenSent
    ? await loadOpenTriggerIds(deps.prisma, projectId)
    : new Set<string>();

  const candidates: CandidateTrigger[] = [];
  for (const trigger of triggers) {
    const params = (trigger.actionParams ?? {}) as ActionParams;
    const operator = params.operator;
    const threshold = params.threshold;
    const timePeriod = params.timePeriod;
    if (operator === undefined || threshold === undefined || timePeriod === undefined) {
      continue;
    }
    const windowMs = Math.max(MIN_BOUND_WINDOW_MS, timePeriod * 60 * 1000);
    const isNoData = isNoDataPredicate({ operator, threshold });
    const isOpen = openIds.has(trigger.id);
    if (!isNoData && !isOpen) continue;
    if (!trigger.customGraphId) continue;

    // ADR-034 Phase 6 source classification. Unknown-source defaults to
    // "trace" so we preserve the pre-Phase-6 behaviour for graphs whose
    // metrics aren't in `field-availability`.
    const lookedUp = await deps.lookupTriggerSource({
      triggerId: trigger.id,
      customGraphId: trigger.customGraphId,
      projectId,
    });
    const source: AnalyticsMetricSource = lookedUp ?? "trace";

    candidates.push({
      triggerId: trigger.id,
      projectId,
      windowMs,
      reasonKind: isOpen ? "resolve" : "absence",
      source,
    });
  }
  return candidates;
}

function groupCandidatesBySource(
  candidates: CandidateTrigger[],
): Map<AnalyticsMetricSource, CandidateTrigger[]> {
  const groups = new Map<AnalyticsMetricSource, CandidateTrigger[]>();
  for (const c of candidates) {
    const existing = groups.get(c.source);
    if (existing) {
      existing.push(c);
    } else {
      groups.set(c.source, [c]);
    }
  }
  return groups;
}

async function loadOpenTriggerIds(
  prisma: PrismaClient,
  projectId: string,
): Promise<Set<string>> {
  const rows = await prisma.triggerSent.findMany({
    where: {
      projectId,
      resolvedAt: null,
      customGraphId: { not: null },
    },
    select: { triggerId: true },
    distinct: ["triggerId"],
  });
  return new Set(rows.map((r) => r.triggerId));
}

async function loadProjectRecency({
  deps,
  projectId,
  source,
  boundWindowMs,
  now,
}: {
  deps: GraphTriggerHeartbeatDeps;
  projectId: string;
  source: AnalyticsMetricSource;
  boundWindowMs: number;
  now: Date;
}): Promise<ProjectRecency> {
  let client: Awaited<ReturnType<ClickHouseClientResolver>>;
  try {
    client = await deps.resolveClickHouseClient(projectId);
  } catch (error) {
    logger.warn(
      {
        projectId,
        source,
        error: error instanceof Error ? error.message : String(error),
      },
      "graphTriggerHeartbeat: ClickHouse client unavailable, treating recency as unknown (no skip)",
    );
    return { projectId, source, lastOccurredAtMs: null };
  }

  const startMs = now.getTime() - boundWindowMs;
  const table = SLIM_TABLE_BY_SOURCE[source];
  const idColumn = SLIM_AGGREGATE_ID_COLUMN_BY_SOURCE[source];
  // One IN-tuple dedup pattern (slim is ReplacingMergeTree(UpdatedAt)),
  // bounded on the partition column (OccurredAt) for partition pruning.
  // TenantId is the first WHERE predicate per multitenancy rules.
  const query = `
    SELECT max(toUnixTimestamp64Milli(OccurredAt)) AS lastMs
    FROM (
      SELECT OccurredAt
      FROM ${table}
      WHERE TenantId = {tenantId:String}
        AND OccurredAt >= toDateTime64({startMs:UInt64} / 1000.0, 3)
        AND (TenantId, ${idColumn}, UpdatedAt) IN (
          SELECT TenantId, ${idColumn}, max(UpdatedAt)
          FROM ${table}
          WHERE TenantId = {tenantId:String}
            AND OccurredAt >= toDateTime64({startMs:UInt64} / 1000.0, 3)
          GROUP BY TenantId, ${idColumn}
        )
    )
  `;
  try {
    const result = await client.query({
      query,
      query_params: { tenantId: projectId, startMs },
      format: "JSONEachRow",
    });
    const rows = (await result.json()) as Array<{ lastMs: string | number | null }>;
    const row = rows[0];
    if (!row || row.lastMs === null || row.lastMs === undefined) {
      return { projectId, source, lastOccurredAtMs: null };
    }
    const ms = typeof row.lastMs === "string" ? Number.parseInt(row.lastMs, 10) : row.lastMs;
    if (!Number.isFinite(ms) || ms <= 0) {
      return { projectId, source, lastOccurredAtMs: null };
    }
    return { projectId, source, lastOccurredAtMs: ms };
  } catch (error) {
    logger.warn(
      {
        projectId,
        source,
        error: error instanceof Error ? error.message : String(error),
      },
      "graphTriggerHeartbeat: ClickHouse recency query failed, treating recency as unknown",
    );
    return { projectId, source, lastOccurredAtMs: null };
  }
}

/** Default deps factory used by the worker bootstrap registration site. */
export function defaultGraphTriggerHeartbeatDeps({
  triggers,
  prisma = defaultPrisma,
}: {
  triggers: TriggerService;
  prisma?: PrismaClient;
}): GraphTriggerHeartbeatDeps {
  return {
    triggers,
    prisma,
    resolveClickHouseClient: async (tenantId) => {
      const client = await getClickHouseClientForProject(tenantId);
      if (!client) {
        throw new Error(
          `ClickHouse not available for tenant ${tenantId}`,
        );
      }
      return client;
    },
    featureFlagService: defaultFeatureFlagService,
    lookupTriggerSource: async ({ customGraphId, projectId }) => {
      // Read the graph's first series' metric and map to a source. The
      // graph is the only place the metric key lives — the trigger's
      // `actionParams.seriesName` carries only the series INDEX.
      const graph = await prisma.customGraph.findFirst({
        where: { id: customGraphId, projectId },
        select: { graph: true },
      });
      if (!graph) return undefined;
      const blob = graph.graph as { series?: Array<{ metric?: string }> } | null;
      const firstMetric = blob?.series?.[0]?.metric;
      if (typeof firstMetric !== "string" || firstMetric.length === 0) {
        return undefined;
      }
      return getMetricSource(firstMetric);
    },
  };
}
