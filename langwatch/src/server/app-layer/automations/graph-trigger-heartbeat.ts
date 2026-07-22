/**
 * ADR-034 Phase 5 — heartbeat sweep for custom-graph threshold alerts,
 * driven by the graphAlertSweep process every 30 seconds (ADR-052 §4; the
 * locked Phase 5 cadence). Every sweep:
 *
 *   1. For each project with graph triggers, load (a) active triggers
 *      whose operator/threshold combination matches `isNoDataPredicate`,
 *      plus (b) active triggers with at least one unresolved `TriggerSent`
 *      row. Union = candidates.
 *   2. Pre-filter (LOCKED by the Phase 5 spec): one batched
 *      `max(OccurredAt)` query against the slim `trace_analytics`
 *      table per project per sweep — bounded by `max(windowMs)` across
 *      that project's candidates. For each candidate, if the project's
 *      most recent qualifying event is older than the candidate's own
 *      window (or NULL), evaluate. If it is recent enough, the
 *      real-time subscriber is already handling that trigger, so skip.
 *   3. Return one candidate per surviving trigger; the sweep intent
 *      handler runs each through the shared `evaluateGraphTrigger`.
 *
 * The sweep does NOT evaluate every active trigger every tick — only the
 * absence cases the event-driven path cannot reach. The shared evaluator
 * picks the actual `fired` / `resolved` / `not_breached` outcome from the
 * analytics data.
 */

import { createLogger } from "@langwatch/observability";
import type { PrismaClient } from "@prisma/client";
import type { ActionParams } from "~/server/app-layer/automations/trigger.types";
import {
  type AnalyticsMetricSource,
  getMetricSource,
} from "~/server/app-layer/analytics/routing/field-availability";
import type { ClickHouseClientResolver } from "~/server/clickhouse/clickhouseClient";
import { getClickHouseClientForProject } from "~/server/clickhouse/clickhouseClient";
import { prisma as defaultPrisma } from "~/server/db";
import { isNoDataPredicate } from "./evaluate-custom-graph-threshold.service";
import type { GraphTriggerEvaluationReason } from "./graph-trigger-evaluation.service";
import { parseSeriesIndex } from "./seriesName";
import type { TriggerPort } from "~/server/domain/automations/trigger.port";

const logger = createLogger(
  "langwatch:app-layer:triggers:graph-trigger-heartbeat",
);

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
  triggers: TriggerPort;
  prisma: PrismaClient;
  /** Resolver matching the slim repository's contract — same signature so
   *  tests can stub a single client and the prod path uses the default
   *  per-project resolver. */
  resolveClickHouseClient: ClickHouseClientResolver;
  /**
   * ADR-034 Phase 6: look up the upstream pipeline source for a graph
   * trigger by reading the metric key of the series the trigger actually
   * watches — the one named by `seriesName`, NOT series 0. A graph may mix
   * trace-backed and eval-backed series, and classifying from the wrong one
   * points the recency probe at the wrong slim table. Returns `undefined`
   * when the source can't be determined (graph missing, series index out of
   * range, metric not in field-availability) — the heartbeat treats those as
   * `"trace"` so behaviour is unchanged for unknown-source triggers.
   */
  lookupTriggerSource(params: {
    triggerId: string;
    customGraphId: string;
    projectId: string;
    /** `"<index>/<key>/<aggregation>"`; see `parseSeriesIndex`. */
    seriesName?: string;
  }): Promise<AnalyticsMetricSource | undefined>;
}

export interface HeartbeatCandidateSources {
  /** Project ids that have at least one active graph trigger. */
  loadProjectsWithGraphTriggers(): Promise<string[]>;
  /** Project ids that have at least one unresolved graph-alert
   *  `TriggerSent` (the "resolve-when-traffic-stops" candidate set).
   *  Returns a Set so the heartbeat can intersect cheaply with the
   *  graph-trigger project set. */
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

/** One surviving sweep candidate: evaluate this trigger with this reason. */
export interface GraphTriggerSweepCandidate {
  triggerId: string;
  projectId: string;
  reason: GraphTriggerEvaluationReason;
}

/**
 * Default candidate-source implementation reading Prisma directly.
 * Exposed for tests via dependency injection at decide time.
 *
 * `Trigger` and `TriggerSent` are project-scoped models, so the
 * multitenancy middleware (`guardProjectId`) rejects a bare cross-project
 * `findMany` — it demands `projectId` or `projectId.in`. This is a genuine
 * cluster-wide discovery scan, so we mirror the cron (routes/cron.ts):
 * enumerate candidate project ids from `Project` (a GLOBAL_MODEL, queryable
 * without a projectId filter) first, then scope the scans with
 * `projectId: { in }`. Without this the heartbeat throws on its first query
 * every tick and no absence/resolve alert ever fires.
 */
export function defaultCandidateSources(
  prisma: PrismaClient,
): HeartbeatCandidateSources {
  const loadCandidateProjectIds = async (): Promise<string[]> => {
    const projects = await prisma.project.findMany({
      where: { firstMessage: true, archivedAt: null },
      select: { id: true },
    });
    return projects.map((p) => p.id);
  };
  return {
    loadProjectsWithGraphTriggers: async () => {
      const projectIds = await loadCandidateProjectIds();
      if (projectIds.length === 0) return [];
      const rows = await prisma.trigger.findMany({
        where: {
          active: true,
          deleted: false,
          customGraphId: { not: null },
          projectId: { in: projectIds },
        },
        select: { projectId: true },
        distinct: ["projectId"],
      });
      return rows.map((r) => r.projectId);
    },
    loadProjectsWithOpenGraphTriggerSent: async () => {
      const projectIds = await loadCandidateProjectIds();
      if (projectIds.length === 0) return new Set<string>();
      const rows = await prisma.triggerSent.findMany({
        where: {
          resolvedAt: null,
          customGraphId: { not: null },
          projectId: { in: projectIds },
        },
        select: { projectId: true },
        distinct: ["projectId"],
      });
      return new Set(rows.map((r) => r.projectId));
    },
  };
}

/**
 * Sweep candidate discovery (no I/O outside its injected deps). Exported
 * so tests can drive it directly without going through the sweep process.
 */
export async function decideGraphTriggerHeartbeat({
  deps,
  sources,
  now,
}: {
  deps: GraphTriggerHeartbeatDeps;
  sources: HeartbeatCandidateSources;
  now: Date;
}): Promise<GraphTriggerSweepCandidate[]> {
  // Step 1: load the union of "has graph triggers" + "has open sent"
  // projects. Every such project is processed — the event-sourced path is
  // the sole graph-alert path (ADR-034: the K8s cron was removed).
  const [graphProjects, openSentProjects] = await Promise.all([
    sources.loadProjectsWithGraphTriggers(),
    sources.loadProjectsWithOpenGraphTriggerSent(),
  ]);
  const projectIds = Array.from(
    new Set<string>([...graphProjects, ...openSentProjects]),
  );
  if (projectIds.length === 0) return [];

  const candidates: GraphTriggerSweepCandidate[] = [];
  for (const projectId of projectIds) {
    try {
      candidates.push(
        ...(await collectCandidatesForProject({
          deps,
          projectId,
          hasOpenSent: openSentProjects.has(projectId),
          now,
        })),
      );
    } catch (error) {
      // One project's failure must not abort the sweep for the others: this
      // is the ONLY path that fires no-data alerts, so a single project's
      // transient DB error would otherwise silence every flagged project's
      // absence alerts for as long as it persists.
      logger.error(
        {
          projectId,
          error: error instanceof Error ? error.message : String(error),
        },
        "graphTriggerHeartbeat: project sweep failed, continuing with other projects",
      );
    }
  }

  if (candidates.length > 0) {
    logger.info(
      { count: candidates.length },
      "graphTriggerHeartbeat surfacing absence/resolve evaluations",
    );
  }
  return candidates;
}

/**
 * Per-project, per-source pre-filter — ONE batched slim query per
 * (project, source) per sweep (at most two per project: `trace_analytics`
 * and `evaluation_analytics`). If the project's recent qualifying activity
 * for a trigger's source is fresher than that trigger's window, the
 * real-time path is already handling it and the candidate is skipped.
 *
 * Throws on an unreadable project; `decideGraphTriggerHeartbeat` isolates
 * that so the remaining projects still get their absence/resolve
 * evaluations.
 */
async function collectCandidatesForProject({
  deps,
  projectId,
  hasOpenSent,
  now,
}: {
  deps: GraphTriggerHeartbeatDeps;
  projectId: string;
  hasOpenSent: boolean;
  now: Date;
}): Promise<GraphTriggerSweepCandidate[]> {
  const candidates = await loadCandidatesForProject({
    deps,
    projectId,
    hasOpenSent,
  });
  if (candidates.length === 0) return [];

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

  const surviving: GraphTriggerSweepCandidate[] = [];
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
    surviving.push({
      triggerId: candidate.triggerId,
      projectId,
      reason:
        candidate.reasonKind === "absence"
          ? "heartbeat-absence"
          : "heartbeat-resolve",
    });
  }
  return surviving;
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
    if (
      operator === undefined ||
      threshold === undefined ||
      timePeriod === undefined
    ) {
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
      seriesName: params.seriesName,
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
    const rows = (await result.json()) as Array<{
      lastMs: string | number | null;
    }>;
    const row = rows[0];
    if (!row || row.lastMs === null || row.lastMs === undefined) {
      return { projectId, source, lastOccurredAtMs: null };
    }
    const ms =
      typeof row.lastMs === "string"
        ? Number.parseInt(row.lastMs, 10)
        : row.lastMs;
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
  triggers: TriggerPort;
  prisma?: PrismaClient;
}): GraphTriggerHeartbeatDeps {
  return {
    triggers,
    prisma,
    resolveClickHouseClient: async (tenantId) => {
      const client = await getClickHouseClientForProject(tenantId);
      if (!client) {
        throw new Error(`ClickHouse not available for tenant ${tenantId}`);
      }
      return client;
    },
    lookupTriggerSource: async ({ customGraphId, projectId, seriesName }) => {
      // The graph is the only place the metric key lives; the trigger's
      // `actionParams.seriesName` carries the series INDEX. Classify from the
      // series the trigger actually watches — a graph may mix trace-backed and
      // eval-backed series, and reading series 0 for a trigger on series 1
      // probes the wrong slim table's recency, which suppresses the alert.
      const graph = await prisma.customGraph.findFirst({
        where: { id: customGraphId, projectId },
        select: { graph: true },
      });
      if (!graph) return undefined;
      const blob = graph.graph as {
        series?: Array<{ metric?: string }>;
      } | null;
      const series = blob?.series;
      if (!series) return undefined;

      const seriesIndex = parseSeriesIndex(seriesName);
      if (
        !Number.isInteger(seriesIndex) ||
        seriesIndex < 0 ||
        seriesIndex >= series.length
      ) {
        return undefined;
      }

      const metric = series[seriesIndex]?.metric;
      if (typeof metric !== "string" || metric.length === 0) {
        return undefined;
      }
      return getMetricSource(metric);
    },
  };
}
