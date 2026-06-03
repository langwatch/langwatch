import type { ConnectionOptions } from "bullmq";
import type { OrphanSweepChainJob } from "~/server/background/types";

import { connection } from "../../redis";
import {
  type OrphanSweepChainOutcome,
  runOrphanSweepChainJob,
} from "../workers/orphanSweepChainWorker";
import { ORPHAN_SWEEP_CHAIN_QUEUE } from "./constants";
import { QueueWithFallback } from "./queueWithFallback";

export { ORPHAN_SWEEP_CHAIN_QUEUE } from "./constants";

/** 24h between chain steps. The worker re-enqueues itself with this delay
 *  on every successful run — that's why this is a chain, not a cron. */
export const ORPHAN_SWEEP_CHAIN_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** Stable jobId per tenant. As long as a chain step exists for a tenant in
 *  any state (waiting/delayed/active), seed attempts dedup to that one job. */
export function orphanSweepChainJobId(tenantId: string): string {
  return `orphan-sweep-chain:${tenantId}`;
}

export const orphanSweepChainQueue = new QueueWithFallback<
  OrphanSweepChainJob,
  OrphanSweepChainOutcome,
  string
>(ORPHAN_SWEEP_CHAIN_QUEUE.NAME, runOrphanSweepChainJob, {
  connection: connection as ConnectionOptions,
  defaultJobOptions: {
    backoff: { type: "exponential", delay: 5000 },
    attempts: 3,
    // Remove finished jobs atomically. BullMQ's `jobId` uniqueness spans
    // ALL states including `completed` / `failed` — if we held the
    // completed history with `age: …`, the listener's re-enqueue (same
    // jobId, +24h delay) would dedup against the still-resident
    // completed job and silently no-op, killing the chain after one run.
    //
    // The 24h dedup property we need for bursty ingest is still upheld:
    // between chain steps, the next job lives in `delayed` state holding
    // the jobId. Ingest re-seeds during that window are no-ops. Job
    // history visibility lives in our logger + posthog capture, not the
    // queue's retention window.
    removeOnComplete: true,
    removeOnFail: true,
  },
});

/**
 * Seed (or no-op into) the per-tenant chain. Called by:
 *   - The ingestion reactor on the first trace event after a tenant becomes
 *     active (delay = 0, sweep right away).
 *   - The chain worker's `completed` listener (delay = 24h, the next link).
 *
 * If a job already exists for this tenant (jobId is held), BullMQ returns
 * the existing one and the add is effectively a no-op — that's the dedup.
 */
export async function seedOrphanSweepChain(
  tenantId: string,
  opts?: { delayMs?: number },
): Promise<void> {
  await orphanSweepChainQueue.add(
    ORPHAN_SWEEP_CHAIN_QUEUE.JOB,
    { tenantId },
    {
      jobId: orphanSweepChainJobId(tenantId),
      delay: opts?.delayMs ?? 0,
    },
  );
}
