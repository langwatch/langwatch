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
import type { ActionParams } from "~/pages/api/cron/triggers/types";
import type { ClickHouseClientResolver } from "~/server/clickhouse/clickhouseClient";
import { getClickHouseClientForProject } from "~/server/clickhouse/clickhouseClient";
import { prisma as defaultPrisma } from "~/server/db";
import { outboxHeartbeatRegistry } from "~/server/event-sourcing/outbox/heartbeat";
import type { OutboxEnqueueRequest } from "~/server/event-sourcing/outbox/outboxReactor.types";
import {
  GRAPH_TRIGGER_EVAL_REACTOR_NAME,
  type GraphEvalStagePayload,
  graphEvalDedupId,
  graphEvalGroupKey,
} from "~/server/event-sourcing/outbox/payload";
import { featureFlagService as defaultFeatureFlagService } from "~/server/featureFlag";
import type { FeatureFlagServiceInterface } from "~/server/featureFlag/types";
import { createLogger } from "~/utils/logger/server";
import { isNoDataPredicate } from "./evaluate-custom-graph-threshold.service";
import type { TriggerService } from "./trigger.service";

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
}

export interface GraphTriggerHeartbeatDeps {
  triggers: TriggerService;
  prisma: PrismaClient;
  /** Resolver matching the slim repository's contract — same signature so
   *  tests can stub a single client and the prod path uses the default
   *  per-project resolver. */
  resolveClickHouseClient: ClickHouseClientResolver;
  featureFlagService: FeatureFlagServiceInterface;
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
 * One project's slim-table recency snapshot. `lastOccurredAtMs` is
 * `null` when the project has no qualifying event in the bounding
 * window — that's the no-data-fire case in its entirety.
 */
interface ProjectRecency {
  projectId: string;
  lastOccurredAtMs: number | null;
}

/** Min window so the heartbeat doesn't issue a degenerate `now - 0` filter. */
const MIN_BOUND_WINDOW_MS = 60_000;

const SLIM_TABLE = "trace_analytics" as const;

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
export function registerGraphTriggerHeartbeat(
  deps: GraphTriggerHeartbeatDeps,
): {
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

    // Step 2: per-project pre-filter — one batched slim query bounded
    // by the largest candidate window. If the project's recent
    // qualifying activity is fresher than a candidate's window, the
    // real-time path is already handling it and we skip the enqueue.
    const boundMs = Math.max(...candidates.map((c) => c.windowMs));
    const recency = await loadProjectRecency({
      deps,
      projectId,
      boundWindowMs: Math.max(MIN_BOUND_WINDOW_MS, boundMs),
      now,
    });

    for (const candidate of candidates) {
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

    candidates.push({
      triggerId: trigger.id,
      projectId,
      windowMs,
      reasonKind: isOpen ? "resolve" : "absence",
    });
  }
  return candidates;
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
  boundWindowMs,
  now,
}: {
  deps: GraphTriggerHeartbeatDeps;
  projectId: string;
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
        error: error instanceof Error ? error.message : String(error),
      },
      "graphTriggerHeartbeat: ClickHouse client unavailable, treating recency as unknown (no skip)",
    );
    return { projectId, lastOccurredAtMs: null };
  }

  const startMs = now.getTime() - boundWindowMs;
  // One IN-tuple dedup pattern (slim is ReplacingMergeTree(UpdatedAt)),
  // bounded on the partition column (OccurredAt) for partition pruning.
  // TenantId is the first WHERE predicate per multitenancy rules.
  const query = `
    SELECT max(toUnixTimestamp64Milli(OccurredAt)) AS lastMs
    FROM (
      SELECT OccurredAt
      FROM ${SLIM_TABLE}
      WHERE TenantId = {tenantId:String}
        AND OccurredAt >= toDateTime64({startMs:UInt64} / 1000.0, 3)
        AND (TenantId, TraceId, UpdatedAt) IN (
          SELECT TenantId, TraceId, max(UpdatedAt)
          FROM ${SLIM_TABLE}
          WHERE TenantId = {tenantId:String}
            AND OccurredAt >= toDateTime64({startMs:UInt64} / 1000.0, 3)
          GROUP BY TenantId, TraceId
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
      return { projectId, lastOccurredAtMs: null };
    }
    const ms =
      typeof row.lastMs === "string"
        ? Number.parseInt(row.lastMs, 10)
        : row.lastMs;
    if (!Number.isFinite(ms) || ms <= 0) {
      return { projectId, lastOccurredAtMs: null };
    }
    return { projectId, lastOccurredAtMs: ms };
  } catch (error) {
    logger.warn(
      {
        projectId,
        error: error instanceof Error ? error.message : String(error),
      },
      "graphTriggerHeartbeat: ClickHouse recency query failed, treating recency as unknown",
    );
    return { projectId, lastOccurredAtMs: null };
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
        throw new Error(`ClickHouse not available for tenant ${tenantId}`);
      }
      return client;
    },
    featureFlagService: defaultFeatureFlagService,
  };
}
