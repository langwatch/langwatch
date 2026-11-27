/**
 * A staff investigation's ingestion figures (ADR-202 ops functions): per project, the traces that
 * occurred in a range, the latest one, and the plan-limit refusals on the UTC days it touches.
 * Spec: modules/trace/specs/trace-ops-reads.feature
 */
import type { TraceIngestionCount } from "@langwatch/trace-contract";

import type { TraceExistenceRepository } from "../../../repositories/trace-existence.repository.ts";
import type { TracePlanLimitRefusalsRepository } from "../repositories/trace-plan-limit-refusals.repository.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

export class TraceIngestionCountService {
  static create({
    existence,
    refusals,
  }: {
    existence: Pick<TraceExistenceRepository, "countTracesByProject">;
    refusals: Pick<TracePlanLimitRefusalsRepository, "countRefusals">;
  }): TraceIngestionCountService {
    return new TraceIngestionCountService(existence, refusals);
  }

  private constructor(
    private readonly existence: Pick<TraceExistenceRepository, "countTracesByProject">,
    private readonly refusals: Pick<TracePlanLimitRefusalsRepository, "countRefusals">,
  ) {}

  /** One row per distinct asked project, in the order asked; an empty range counts nothing. */
  async countIngestionByProject({
    projectIds,
    since,
    until,
  }: {
    projectIds: readonly string[];
    since: number;
    until: number;
  }): Promise<TraceIngestionCount[]> {
    const asked = [...new Set(projectIds)];
    if (asked.length === 0) return [];
    if (until <= since) {
      return asked.map((projectId) => ({
        projectId,
        traces: 0,
        lastTraceAt: null,
        planLimitRefusals: 0,
      }));
    }
    const [traces, refusals] = await Promise.all([
      this.existence.countTracesByProject({ projectIds: asked, since, until }),
      this.refusals.countRefusals({
        projectIds: asked,
        fromDayMs: Math.floor(since / DAY_MS) * DAY_MS,
        toDayMs: Math.floor((until - 1) / DAY_MS) * DAY_MS,
      }),
    ]);
    const byProject = new Map(traces.map((row) => [row.projectId, row]));
    return asked.map((projectId) => ({
      projectId,
      traces: byProject.get(projectId)?.traces ?? 0,
      lastTraceAt: byProject.get(projectId)?.lastTraceAt ?? null,
      planLimitRefusals: refusals.get(projectId) ?? 0,
    }));
  }
}
