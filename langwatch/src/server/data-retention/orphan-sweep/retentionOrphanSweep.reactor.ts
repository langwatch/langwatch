import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import type { TraceProcessingEvent } from "~/server/event-sourcing/pipelines/trace-processing";
import type { ReactorDefinition } from "~/server/event-sourcing/reactors/reactor.types";
import { createLogger } from "~/utils/logger/server";
import type { RetentionPolicyCache } from "../retentionPolicyCache";
import type { OrphanSweepService } from "./orphanSweep.service";

const logger = createLogger("langwatch:data-retention:orphan-reactor");

interface RetentionOrphanSweepReactorDeps {
  orphanSweep: OrphanSweepService;
  retentionPolicyCache: RetentionPolicyCache;
}

export function createRetentionOrphanSweepReactor(
  deps: RetentionOrphanSweepReactorDeps,
): ReactorDefinition<TraceProcessingEvent, TraceSummaryData> {
  return {
    name: "retentionOrphanSweep",
    options: {
      makeJobId: (payload) =>
        `retention-orphan-sweep:${payload.event.tenantId}`,
      ttl: 60 * 60 * 1000,
      delay: 5_000,
    },
    async handle(event, context) {
      const { tenantId } = context;

      const retentionDays = await deps.retentionPolicyCache.getRetentionDays(
        tenantId,
        "traces",
      );
      if (retentionDays === 0) return;

      try {
        await deps.orphanSweep.sweepProject({ projectId: tenantId });
      } catch (error) {
        logger.error({ tenantId, error }, "Orphan sweep reactor failed");
      }
    },
  };
}
