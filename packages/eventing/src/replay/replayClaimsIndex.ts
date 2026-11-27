import { readTenantClaimedGroups } from "@langwatch/group-queue";
import type { Cluster, Redis as IORedis } from "ioredis";

/** Every event-sourcing job runs on this one queue; the braces are its Redis hash tag. */
export const EVENT_SOURCING_QUEUE_KEY_NAME = "{event-sourcing/jobs}";

/**
 * The queue's list of each tenant's claimed groups, as the replay drain reads it (ADR-092,
 * packages/group-queue/adrs/092-tenant-claims-index.md). Trusted only while `isReady` says so.
 */
export interface ReplayClaimsIndex {
  /** True once every live writer lists its claims and older claims are backfilled. */
  isReady(): Promise<boolean>;
  /** The tenant's groups under the prefix that still hold an active key or a claimed record. */
  claimedGroups(input: { tenantId: string; groupIdPrefix: string }): Promise<string[]>;
}

/** A drain that would trust an index older writers may not feed; the batch fails instead. */
export class ReplayClaimsIndexNotReadyError extends Error {
  readonly code = "replay_claims_index_not_ready";
  constructor() {
    super(
      "The queue's claimed-groups index is not ready (older workers still serve, or its backfill has not finished); the batch retries on the next run.",
    );
    this.name = "ReplayClaimsIndexNotReadyError";
  }
}

/** No readiness wired: never trusted, so a composition that forgets it fails closed. */
export const UNWIRED_REPLAY_CLAIMS_INDEX: ReplayClaimsIndex = {
  isReady: async () => false,
  claimedGroups: async () => [],
};

/** The event-sourcing queue's index over `redis`, trusted when `isReady` answers true. */
export function eventSourcingClaimsIndex({
  redis,
  isReady,
}: {
  redis: IORedis | Cluster;
  isReady: () => Promise<boolean>;
}): ReplayClaimsIndex {
  return {
    isReady,
    claimedGroups: ({ tenantId, groupIdPrefix }) =>
      readTenantClaimedGroups({
        redis,
        queueName: EVENT_SOURCING_QUEUE_KEY_NAME,
        tenantId,
        groupIdPrefix,
      }),
  };
}

/** A ready index with nothing claimed, for tests whose drain should find no running work. */
export const IDLE_REPLAY_CLAIMS_INDEX: ReplayClaimsIndex = {
  isReady: async () => true,
  claimedGroups: async () => [],
};
