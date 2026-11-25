import { createLogger, type Logger } from "@langwatch/observability";

import type { TenancyRepository } from "../repositories/tenancy.repository.ts";
import type { TraceCountRepository } from "../repositories/trace-count.repository.ts";

const defaultLogger = createLogger("langwatch:usage:traceUsage");

/**
 * Writes one usage row per trace and month under the project's organization. A trace written
 * twice collapses on the table's key, so redelivery and the upgrade's overlap with live are
 * harmless. A failed insert throws so the queue redelivers; an orphan project is skipped loudly.
 */
export class TraceUsageService {
  private constructor(
    private readonly counts: Pick<TraceCountRepository, "insert">,
    private readonly projects: Pick<TenancyRepository, "getProjectPlacement">,
    private readonly logger: Pick<Logger, "warn">,
  ) {}

  static create({
    counts,
    projects,
    logger = defaultLogger,
  }: {
    counts: Pick<TraceCountRepository, "insert">;
    projects: Pick<TenancyRepository, "getProjectPlacement">;
    logger?: Pick<Logger, "warn">;
  }): TraceUsageService {
    return new TraceUsageService(counts, projects, logger);
  }

  async recordTraces({
    projectId,
    month,
    traceIds,
  }: {
    projectId: string;
    month: string;
    traceIds: readonly string[];
  }): Promise<void> {
    if (traceIds.length === 0) return;
    const placement = await this.projects.getProjectPlacement({ projectId });
    if (placement.kind === "unplaced") {
      this.logger.warn({ projectId }, "orphan project has no organization, trace not counted");
      return;
    }
    await this.counts.insert({
      organizationId: placement.organizationId,
      rows: traceIds.map((traceId) => ({ projectId, traceId, month })),
    });
  }
}
