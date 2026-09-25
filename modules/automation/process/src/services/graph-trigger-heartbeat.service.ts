/**
 * Heartbeat sweep for custom-graph threshold alerts per ADR-034 Phase 5: pre-filters
 * by data window and evaluates survivors that event-driven path cannot reach.
 */

import type { AnalyticsApi } from "@langwatch/analytics-contract";
import { isNoDataPredicate, type GraphTriggerSweepCandidate } from "@langwatch/automation-contract";
import type { Instant } from "@langwatch/time";
import { z } from "zod";

import type { AutomationLogger } from "../app/automation.members.ts";
import type {
  AnalyticsMetricSource as RepositoryMetricSource,
  GraphTriggerSentRepository,
} from "../repositories/graph-trigger-sent.repository.ts";
import type { TriggerRepository } from "../repositories/trigger.repository.ts";

export type AnalyticsMetricSource = RepositoryMetricSource;

export const GRAPH_TRIGGER_HEARTBEAT_NAME = "graphTriggerHeartbeat" as const;
export const GRAPH_TRIGGER_HEARTBEAT_INTERVAL_MS = 30_000;

const heartbeatActionParamsSchema = z
  .object({
    operator: z.string().optional(),
    threshold: z.number().optional(),
    timePeriod: z.number().optional(),
    seriesName: z.string().optional(),
  })
  .passthrough();

type HeartbeatShape =
  | {
      kind: "watched";
      params: z.infer<typeof heartbeatActionParamsSchema>;
      customGraphId: string;
      windowMs: number;
      isOpen: boolean;
    }
  | { kind: "skip" };

interface CandidateTrigger {
  triggerId: string;
  projectId: string;
  windowMs: number;
  /** "absence" = no-data shape; "resolve" = firing-resolve when traffic stops. */
  reasonKind: "absence" | "resolve";
  /**
   * ADR-034 §6: the upstream pipeline whose slim table the heartbeat
   * queries for recency -- `"trace"` queries `trace_analytics`,
   * `"evaluation"` queries `evaluation_analytics`. Unknown defaults to `"trace"`.
   */
  source: AnalyticsMetricSource;
}

export interface GraphTriggerHeartbeatDeps {
  triggers: TriggerRepository;
  triggerSent: GraphTriggerSentRepository;
  /** Each source's last event, read from the analytics module's own tables. */
  analytics: Pick<AnalyticsApi, "findLastOccurredAt">;
  logger: AutomationLogger;
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

/** One surviving sweep candidate: evaluate this trigger with this reason. */
/**
 * Sweep candidate discovery (no I/O outside its injected deps). Exported
 * so tests can drive it directly without going through the sweep process.
 */
export class GraphTriggerHeartbeatService {
  private constructor(private readonly deps: GraphTriggerHeartbeatDeps) {}

  static create(deps: GraphTriggerHeartbeatDeps): GraphTriggerHeartbeatService {
    return new GraphTriggerHeartbeatService(deps);
  }

  async decide({ now }: { now: Instant }): Promise<GraphTriggerSweepCandidate[]> {
    const deps = this.deps;
    const triggerSent = deps.triggerSent;
    // Step 1: load the union of "has graph triggers" + "has open sent"
    // projects. Every such project is processed — the event-sourced path is
    // the sole graph-alert path (ADR-034: the K8s cron was removed).
    const [graphProjects, openSentProjects] = await Promise.all([
      triggerSent.findProjectsWithGraphTriggers(),
      triggerSent.findProjectsWithOpenGraphTriggerSent(),
    ]);
    const projectIds = Array.from(new Set<string>([...graphProjects, ...openSentProjects]));
    if (projectIds.length === 0) {
      return [];
    }

    const candidates: GraphTriggerSweepCandidate[] = [];
    for (const projectId of projectIds) {
      try {
        candidates.push(
          ...(await this.collectCandidatesForProject({
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
        deps.logger.error(
          {
            projectId,
            error: error instanceof Error ? error.message : String(error),
          },
          "graphTriggerHeartbeat: project sweep failed, continuing with other projects",
        );
      }
    }

    if (candidates.length > 0) {
      deps.logger.info(
        { count: candidates.length },
        "graphTriggerHeartbeat surfacing absence/resolve evaluations",
      );
    }

    return candidates;
  }

  /**
   * One pre-filter query per (project, source) per sweep; skips if recent
   * activity is fresher than trigger window (real-time path already active).
   */
  private async collectCandidatesForProject({
    deps,
    projectId,
    hasOpenSent,
    now,
  }: {
    deps: GraphTriggerHeartbeatDeps;
    projectId: string;
    hasOpenSent: boolean;
    now: Instant;
  }): Promise<GraphTriggerSweepCandidate[]> {
    const candidates = await this.loadCandidatesForProject({
      deps,
      projectId,
      hasOpenSent,
    });
    if (candidates.length === 0) {
      return [];
    }

    const candidatesBySource = GraphTriggerHeartbeatService.groupCandidatesBySource(candidates);
    const recencyBySource = new Map<AnalyticsMetricSource, ProjectRecency>();
    for (const [source, sourceCandidates] of candidatesBySource.entries()) {
      const boundMs = Math.max(...sourceCandidates.map((c) => c.windowMs));
      const recency = await this.loadProjectRecency({
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
      if (!recency) {
        continue;
      }

      const cutoff = now.epochMilliseconds - candidate.windowMs;
      if (recency.lastOccurredAtMs !== null && recency.lastOccurredAtMs > cutoff) {
        // Real-time path is firing for this trigger; skip.
        continue;
      }

      surviving.push({
        triggerId: candidate.triggerId,
        projectId,
        reason: candidate.reasonKind === "absence" ? "heartbeat-absence" : "heartbeat-resolve",
      });
    }

    return surviving;
  }

  private async loadCandidatesForProject({
    deps,
    projectId,
    hasOpenSent,
  }: {
    deps: GraphTriggerHeartbeatDeps;
    projectId: string;
    hasOpenSent: boolean;
  }): Promise<CandidateTrigger[]> {
    const triggers = (await deps.triggers.findActiveForProject(projectId)).filter(
      (trigger) => trigger.customGraphId !== null && trigger.triggerKind !== "REPORT",
    );
    if (triggers.length === 0) {
      return [];
    }

    const openIds = hasOpenSent
      ? await deps.triggerSent.findOpenTriggerIdsForProject(projectId)
      : new Set<string>();

    const candidates: CandidateTrigger[] = [];
    for (const trigger of triggers) {
      const shape = GraphTriggerHeartbeatService.heartbeatShapeOf({ trigger, openIds });
      if (shape.kind === "skip") continue;
      const { params, windowMs, isOpen } = shape;

      // ADR-034 Phase 6 source classification. Unknown-source defaults to
      // "trace" so we preserve the pre-Phase-6 behaviour for graphs whose
      // metrics aren't in `field-availability`.
      const lookedUp = await deps.triggerSent.findGraphTriggerSource({
        triggerId: trigger.id,
        customGraphId: shape.customGraphId,
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

  /** A trigger the sweep watches: a no-data predicate, or an open alert that may resolve. */
  private static heartbeatShapeOf({
    trigger,
    openIds,
  }: {
    trigger: { id: string; customGraphId: string | null; actionParams?: unknown };
    openIds: Set<string>;
  }): HeartbeatShape {
    const parsed = heartbeatActionParamsSchema.safeParse(trigger.actionParams ?? {});
    if (!parsed.success) return { kind: "skip" };
    const params = parsed.data;
    const { operator, threshold, timePeriod } = params;
    if (operator === void 0 || threshold === void 0 || timePeriod === void 0) {
      return { kind: "skip" };
    }
    const isOpen = openIds.has(trigger.id);
    if (!isNoDataPredicate({ operator, threshold }) && !isOpen) return { kind: "skip" };
    if (!trigger.customGraphId) return { kind: "skip" };
    return {
      kind: "watched",
      params,
      customGraphId: trigger.customGraphId,
      windowMs: Math.max(MIN_BOUND_WINDOW_MS, timePeriod * 60 * 1000),
      isOpen,
    };
  }

  private static groupCandidatesBySource(
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

  private async loadProjectRecency({
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
    now: Instant;
  }): Promise<ProjectRecency> {
    try {
      const [lastOccurredAt] = await deps.analytics.findLastOccurredAt({
        projectId,
        source,
        since: now.subtract({ milliseconds: boundWindowMs }),
      });

      return {
        projectId,
        source,
        lastOccurredAtMs: lastOccurredAt ? lastOccurredAt.epochMilliseconds : null,
      };
    } catch (error) {
      deps.logger.warn(
        {
          projectId,
          source,
          error: error instanceof Error ? error.message : String(error),
        },
        "graphTriggerHeartbeat: recency read failed, treating recency as unknown",
      );

      return { projectId, source, lastOccurredAtMs: null };
    }
  }
}
