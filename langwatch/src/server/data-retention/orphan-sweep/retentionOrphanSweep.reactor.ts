import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import type { TraceProcessingEvent } from "~/server/event-sourcing/pipelines/trace-processing";
import type { ReactorDefinition } from "~/server/event-sourcing/reactors/reactor.types";
import { createLogger } from "~/utils/logger/server";
import type { RetentionPolicyCache } from "../retentionPolicyCache";
import { INDEFINITE_RETENTION_DAYS } from "../retentionPolicy.schema";

const logger = createLogger("langwatch:data-retention:orphan-reactor");

interface RetentionOrphanSweepReactorDeps {
  retentionPolicyCache: RetentionPolicyCache;
  /**
   * Dispatches the orphan-sweep command for `tenantId` onto the
   * event-sourcing groupQueue. The pipeline owns the 6h-cadence
   * self-perpetuation — this reactor only ensures the command is seeded
   * for any tenant that ingests. Injected so tests don't have to wire
   * the event-sourcing runtime.
   */
  dispatchSweep: (params: { tenantId: string }) => Promise<void>;
}

/**
 * Reactor that dispatches the per-tenant orphan-sweep command on first ingest.
 *
 * Why a self-perpetuating command (not a cron): tenants stop ingesting, but
 * their CH trace rows keep being deleted by retention TTL. A cron-style sweep
 * over all projects is heavy and wakes inactive tenants needlessly. A
 * per-tenant command only costs work for tenants that ever ingest; once
 * dispatched, it self-perpetuates via selfDispatch (delay = 6h) on the
 * event-sourcing groupQueue.
 *
 * The reactor's own dedup window is intentionally short: bursty ingest from
 * one tenant should fold into one dispatch attempt, but the canonical sweep
 * cadence lives in the pipeline's deduplication TTL, not here.
 */
export function createRetentionOrphanSweepReactor(
  deps: RetentionOrphanSweepReactorDeps,
): ReactorDefinition<TraceProcessingEvent, TraceSummaryData> {
  return {
    name: "retentionOrphanSweep",
    options: {
      makeJobId: (payload) =>
        `retention-orphan-sweep-seed:${payload.event.tenantId}`,
      // Short window so a flurry of trace events from one tenant doesn't
      // spam seed attempts; the chain's jobId is the real dedup.
      ttl: 60_000,
      delay: 5_000,
    },
    async handle(event, context) {
      const { tenantId } = context;

      const retentionDays = await deps.retentionPolicyCache.getRetentionDays(
        tenantId,
        "traces",
      );
      // INDEFINITE retention (platform-admin only): CH never deletes, so the
      // orphan sweep has nothing to do — skip the seed entirely.
      if (retentionDays === INDEFINITE_RETENTION_DAYS) return;

      try {
        await deps.dispatchSweep({ tenantId });
      } catch (error) {
        logger.error(
          { tenantId, error },
          "failed to dispatch orphan sweep command — next ingest will retry",
        );
      }
    },
  };
}
