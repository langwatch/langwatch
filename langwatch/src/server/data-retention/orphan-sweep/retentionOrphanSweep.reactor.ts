import type { ReactorDefinition } from "~/server/event-sourcing/reactors/reactor.types";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import type { TraceProcessingEvent } from "~/server/event-sourcing/pipelines/trace-processing";
import type { OrphanSweepService } from "./orphanSweep.service";
import type { RetentionPolicyCache } from "../retentionPolicyCache";
import { TtlCache } from "~/server/utils/ttlCache";
import { createLogger } from "~/utils/logger/server";

const logger = createLogger("langwatch:data-retention:orphan-reactor");

const SWEEP_DEDUP_TTL_MS = 60 * 60 * 1000;

interface RetentionOrphanSweepReactorDeps {
  orphanSweep: OrphanSweepService;
  retentionPolicyCache: RetentionPolicyCache;
}

export function createRetentionOrphanSweepReactor(
  deps: RetentionOrphanSweepReactorDeps,
): ReactorDefinition<TraceProcessingEvent, TraceSummaryData> {
  const sweepDedup = new TtlCache<boolean>(SWEEP_DEDUP_TTL_MS, "retention-orphan-sweep-dedup:");

  return {
    name: "retentionOrphanSweep",
    options: {
      makeJobId: (payload) =>
        `retention-orphan-sweep:${payload.event.tenantId}`,
      ttl: SWEEP_DEDUP_TTL_MS,
      delay: 5_000,
    },
    async handle(event, context) {
      const { tenantId } = context;

      const retentionDays = await deps.retentionPolicyCache.getRetentionDays(
        tenantId,
        "traces",
      );
      if (retentionDays === 0) return;

      const dedupKey = tenantId;
      const alreadySwept = await sweepDedup.get(dedupKey);
      if (alreadySwept) return;

      await sweepDedup.set(dedupKey, true);

      try {
        await deps.orphanSweep.cleanupOrphans({
          projectId: tenantId,
          orphanedTraceIds: [],
        });
      } catch (error) {
        logger.error({ tenantId, error }, "Orphan sweep reactor failed");
      }
    },
  };
}
