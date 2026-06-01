import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import type { TraceProcessingEvent } from "~/server/event-sourcing/pipelines/trace-processing";
import type { ReactorDefinition } from "~/server/event-sourcing/reactors/reactor.types";
import { createLogger } from "~/utils/logger/server";
import type { RetentionPolicyCache } from "../retentionPolicyCache";

const logger = createLogger("langwatch:data-retention:orphan-reactor");

interface RetentionOrphanSweepReactorDeps {
  retentionPolicyCache: RetentionPolicyCache;
  /**
   * Seeds the per-tenant orphan-sweep chain for `tenantId`. The chain owns
   * the sweep + the 24h-cadence self-perpetuation — this reactor only
   * ensures the chain *exists* for any tenant that ingests. Injected so
   * tests don't have to wire BullMQ.
   */
  seedChain: (params: { tenantId: string }) => Promise<void>;
}

/**
 * Reactor that seeds a per-tenant orphan-sweep chain on the first ingest.
 *
 * Why a chain (not a tick): tenants stop ingesting, but their CH trace rows
 * keep being deleted by retention TTL. A cron-style sweep over all projects
 * is heavy and wakes inactive tenants needlessly. A per-tenant chain only
 * costs work for tenants that ever ingest; once seeded, it self-perpetuates
 * via the worker's `completed` listener (delay = 24h).
 *
 * The reactor's own dedup window is intentionally short: bursty ingest from
 * one tenant should fold into one chain step, but the canonical "1 sweep
 * per tenant per 24h" cadence lives in the chain's stable jobId, not here.
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
      if (retentionDays === 0) return;

      try {
        await deps.seedChain({ tenantId });
      } catch (error) {
        logger.error(
          { tenantId, error },
          "failed to seed orphan sweep chain — next ingest will retry",
        );
      }
    },
  };
}
