#!/usr/bin/env npx tsx
/**
 * Migration script for BullMQ queue name changes.
 *
 * When queue names change (e.g., "event-sourcing" → "{event_sourcing}"),
 * BullMQ creates new Redis keys. Jobs under old key names become orphaned
 * and will never be processed because workers now listen on new names.
 *
 * The migration is a safe two-step process:
 *
 *   Step 1: COPY jobs from old queues to new hash-tagged queues.
 *           Old keys are left intact — nothing is deleted.
 *           Safe to re-run (uses deterministic job IDs for idempotency).
 *
 *   Step 2: CLEANUP old keys once you've verified migration worked.
 *           Run dry-run first to confirm new queues have the jobs,
 *           then cleanup to remove old keys.
 *
 * Usage:
 *   npx tsx scripts/migrate-queue-names.ts              # Dry-run (report only)
 *   npx tsx scripts/migrate-queue-names.ts --migrate     # Copy jobs to new queues (no delete)
 *   npx tsx scripts/migrate-queue-names.ts --cleanup     # Delete old keys (after verifying)
 *
 * Environment:
 *   REDIS_URL or REDIS_CLUSTER_ENDPOINTS must be set.
 */

import IORedis, { Cluster } from "ioredis";
import { Queue } from "bullmq";

// ---------------------------------------------------------------------------
// Queue name mapping
// ---------------------------------------------------------------------------

/**
 * Static mapping from old queue names to new hash-tagged names.
 * Note: "event-sourcing" was also renamed to "event_sourcing" (underscore).
 */
export const STATIC_QUEUE_MAPPING: Record<string, string> = {
  collector: "{collector}",
  evaluations: "{evaluations}",
  topic_clustering: "{topic_clustering}",
  track_events: "{track_events}",
  usage_stats: "{usage_stats}",
  "event-sourcing": "{event_sourcing}",
  "simulations/scenarios/executions": "{simulations/scenarios/executions}",
};

/** Prefixes for dynamically-named pipeline queues. */
const PIPELINE_PREFIXES = ["trace_processing", "evaluation_processing"];

/**
 * Old queue name patterns to scan for. These are the pre-hash-tag names
 * that become orphaned after migrating to hash-tagged names.
 */
export const OLD_QUEUE_PATTERNS = [
  // Static queues
  "bull:collector:*",
  "bull:evaluations:*",
  "bull:topic_clustering:*",
  "bull:track_events:*",
  "bull:usage_stats:*",
  "bull:event-sourcing:*",
  "bull:simulations/scenarios/executions:*",
  // Dynamic pipeline queues
  "bull:trace_processing/*",
  "bull:evaluation_processing/*",
];

// ---------------------------------------------------------------------------
// Core functions (exported for testing)
// ---------------------------------------------------------------------------

function createConnection(): IORedis | Cluster {
  const clusterEndpoints = process.env.REDIS_CLUSTER_ENDPOINTS;
  const redisUrl = process.env.REDIS_URL;

  if (clusterEndpoints) {
    const endpoints = clusterEndpoints.split(",").map((raw) => {
      const url = raw.includes("://")
        ? new URL(raw)
        : new URL(`redis://${raw}`);
      return { host: url.hostname, port: Number(url.port || 6379) };
    });
    return new Cluster(endpoints, {
      redisOptions: { maxRetriesPerRequest: null },
    });
  }

  if (redisUrl) {
    return new IORedis(redisUrl, { maxRetriesPerRequest: null });
  }

  console.error("Error: Set REDIS_URL or REDIS_CLUSTER_ENDPOINTS");
  process.exit(1);
}

/**
 * Scans Redis for keys matching a glob pattern.
 * Supports both standalone Redis and Redis Cluster (scans each master node).
 */
export async function scanKeys(
  connection: IORedis | Cluster,
  pattern: string,
): Promise<string[]> {
  const keys: string[] = [];

  if (connection instanceof Cluster) {
    const masters = connection.nodes("master");
    for (const node of masters) {
      let cursor = "0";
      do {
        const [next, batch] = await node.scan(
          cursor,
          "MATCH",
          pattern,
          "COUNT",
          100,
        );
        cursor = next;
        keys.push(...batch);
      } while (cursor !== "0");
    }
  } else {
    let cursor = "0";
    do {
      const [next, batch] = await connection.scan(
        cursor,
        "MATCH",
        pattern,
        "COUNT",
        100,
      );
      cursor = next;
      keys.push(...batch);
    } while (cursor !== "0");
  }

  return keys;
}

/**
 * Discovers pipeline queue names from Redis by looking for meta keys.
 * Returns a mapping of old name → new hash-tagged name.
 */
export async function discoverPipelineQueues(
  connection: IORedis | Cluster,
): Promise<Record<string, string>> {
  const mapping: Record<string, string> = {};

  for (const prefix of PIPELINE_PREFIXES) {
    const metaKeys = await scanKeys(connection, `bull:${prefix}/*:meta`);
    for (const metaKey of metaKeys) {
      // bull:trace_processing/handler/ingestTrace:meta → trace_processing/handler/ingestTrace
      const queueName = metaKey.replace(/^bull:/, "").replace(/:meta$/, "");
      mapping[queueName] = `{${queueName}}`;
    }
  }

  return mapping;
}

/**
 * Builds the full old→new queue name mapping by combining static names
 * with dynamically discovered pipeline queues.
 */
export async function buildQueueMapping(
  connection: IORedis | Cluster,
): Promise<Record<string, string>> {
  const pipelineQueues = await discoverPipelineQueues(connection);
  return { ...STATIC_QUEUE_MAPPING, ...pipelineQueues };
}

/**
 * Reads job IDs from an old queue's wait, delayed, and active lists.
 * Uses raw Redis commands (single-key ops) so it works on both standalone and cluster.
 */
export async function readJobIds(
  connection: IORedis | Cluster,
  oldQueueName: string,
): Promise<string[]> {
  const ids = new Set<string>();

  // wait and active are Redis LISTs
  const waitIds = await connection.lrange(
    `bull:${oldQueueName}:wait`,
    0,
    -1,
  );
  const activeIds = await connection.lrange(
    `bull:${oldQueueName}:active`,
    0,
    -1,
  );

  // delayed is a Redis SORTED SET
  const delayedIds = await connection.zrange(
    `bull:${oldQueueName}:delayed`,
    0,
    -1,
  );

  for (const id of [...waitIds, ...activeIds, ...delayedIds]) {
    ids.add(id);
  }

  return Array.from(ids);
}

/**
 * Reads a single job's data from its Redis hash.
 * Returns null if the job hash doesn't exist or has no data.
 */
export async function readJobData(
  connection: IORedis | Cluster,
  oldQueueName: string,
  jobId: string,
): Promise<{
  name: string;
  data: unknown;
  opts: Record<string, unknown>;
} | null> {
  const hash = await connection.hgetall(`bull:${oldQueueName}:${jobId}`);

  if (!hash || !hash.data) {
    return null;
  }

  try {
    return {
      name: hash.name || "unknown",
      data: JSON.parse(hash.data),
      opts: hash.opts ? JSON.parse(hash.opts) : {},
    };
  } catch {
    return null;
  }
}

/**
 * Redis key for tracking which jobs have been copied.
 * This is the source of truth for idempotency — NOT BullMQ's job IDs,
 * because BullMQ removes job IDs when jobs complete (removeOnComplete).
 *
 * If we relied on BullMQ job IDs alone:
 *   1. --migrate copies job with jobId "migrated:collector:42"
 *   2. Worker processes it, job completes and gets removed
 *   3. Re-run --migrate → jobId is gone → BullMQ creates a DUPLICATE
 *
 * By tracking in a separate Redis set, we know what was already copied
 * regardless of whether workers have processed the jobs.
 */
export const MIGRATION_TRACKER_KEY = "migration:queue-names:copied";

/**
 * Returns the tracker member string for a given old queue + job ID.
 */
export function migrationTrackerId(
  oldQueueName: string,
  oldJobId: string,
): string {
  return `${oldQueueName}:${oldJobId}`;
}

export interface MigrateResult {
  copied: number;
  skipped: number;
  alreadyCopied: number;
  failed: Array<{ jobId: string; error: string }>;
}

/**
 * Copies jobs from an old queue to a new hash-tagged queue.
 *
 * - Reads job data using raw Redis commands (works on cluster)
 * - Checks a Redis SET to skip already-copied jobs (survives job completion)
 * - Re-adds via BullMQ Queue.add()
 * - Records each copied job in the tracker set
 * - Does NOT delete old keys — that's a separate step
 * - Safe to re-run: tracker set prevents duplicates even after workers
 *   process and remove the copied jobs
 * - Continues on per-job errors, reports all failures at the end
 */
export async function copyJobs(
  connection: IORedis | Cluster,
  oldQueueName: string,
  newQueueName: string,
): Promise<MigrateResult> {
  const result: MigrateResult = {
    copied: 0,
    skipped: 0,
    alreadyCopied: 0,
    failed: [],
  };

  const jobIds = await readJobIds(connection, oldQueueName);
  if (jobIds.length === 0) return result;

  const newQueue = new Queue(newQueueName, {
    connection: connection as any,
  });

  try {
    for (const jobId of jobIds) {
      // Check if we already copied this job (idempotency)
      const trackerId = migrationTrackerId(oldQueueName, jobId);
      const alreadyDone = await connection.sismember(
        MIGRATION_TRACKER_KEY,
        trackerId,
      );
      if (alreadyDone) {
        result.alreadyCopied++;
        continue;
      }

      const job = await readJobData(connection, oldQueueName, jobId);
      if (!job) {
        result.skipped++;
        continue;
      }

      try {
        await newQueue.add(job.name, job.data, {
          delay: (job.opts.delay as number) ?? undefined,
          priority: (job.opts.priority as number) ?? undefined,
          attempts: (job.opts.attempts as number) ?? undefined,
          backoff: job.opts.backoff as any,
        });

        // Record that we copied this job
        await connection.sadd(MIGRATION_TRACKER_KEY, trackerId);
        result.copied++;
      } catch (err) {
        result.failed.push({
          jobId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  } finally {
    await newQueue.close();
  }

  return result;
}

/**
 * Deletes keys using UNLINK (async, non-blocking) in batches.
 * Returns the number of keys deleted.
 */
export async function cleanupKeys(
  connection: IORedis | Cluster,
  keys: string[],
): Promise<number> {
  const BATCH_SIZE = 100;
  for (let i = 0; i < keys.length; i += BATCH_SIZE) {
    const batch = keys.slice(i, i + BATCH_SIZE);
    await Promise.all(batch.map((key) => connection.unlink(key)));
    if (keys.length > BATCH_SIZE) {
      console.log(
        `    … ${Math.min(i + BATCH_SIZE, keys.length)}/${keys.length} deleted`,
      );
    }
  }
  return keys.length;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

async function main() {
  const migrate = process.argv.includes("--migrate");
  const cleanup = process.argv.includes("--cleanup");

  if (migrate && cleanup) {
    console.error("Error: Use --migrate or --cleanup, not both.");
    console.error("  --migrate first (copies jobs), then --cleanup (deletes old keys).");
    process.exit(1);
  }

  const mode = migrate ? "MIGRATE (copy jobs, keep old keys)" : cleanup ? "CLEANUP (delete old keys)" : "DRY-RUN";
  console.log(`Mode: ${mode}`);
  console.log("");

  const connection = createConnection();

  // Phase 1: Discover what exists
  let totalOrphaned = 0;
  const allOldKeys: string[] = [];

  for (const pattern of OLD_QUEUE_PATTERNS) {
    const keys = await scanKeys(connection, pattern);
    if (keys.length > 0) {
      console.log(`  ${pattern}: ${keys.length} keys`);
      totalOrphaned += keys.length;
      allOldKeys.push(...keys);
    }
  }

  if (totalOrphaned === 0) {
    console.log("No orphaned keys found. Migration is clean.");
    await connection.quit();
    return;
  }

  console.log("");
  console.log(`Total: ${totalOrphaned} orphaned keys`);

  // Phase 1b: Check migration status (how many jobs are already copied?)
  const trackerSize = await connection.scard(MIGRATION_TRACKER_KEY);
  const mapping = await buildQueueMapping(connection);

  let totalPendingJobs = 0;
  let totalTrackedJobs = 0;

  for (const [oldName] of Object.entries(mapping)) {
    const jobIds = await readJobIds(connection, oldName);
    for (const jobId of jobIds) {
      const tracked = await connection.sismember(
        MIGRATION_TRACKER_KEY,
        migrationTrackerId(oldName, jobId),
      );
      if (tracked) {
        totalTrackedJobs++;
      } else {
        totalPendingJobs++;
      }
    }
  }

  if (trackerSize > 0) {
    console.log("");
    console.log(`Migration status: ${totalTrackedJobs} jobs already copied, ${totalPendingJobs} pending`);
    if (totalPendingJobs === 0 && !migrate) {
      console.log("  ✓ All jobs have been copied. Safe to run --cleanup.");
    }
  }

  // Phase 2: Copy jobs to new queues (if --migrate)
  if (migrate) {
    console.log("");
    console.log("Copying jobs from old queues to new hash-tagged queues...");
    console.log("(Old keys are NOT deleted — run --cleanup separately after verifying.)");
    console.log("");

    const mapping = await buildQueueMapping(connection);
    let totalCopied = 0;
    let totalSkipped = 0;
    let totalAlreadyCopied = 0;
    const allFailures: Array<{ queue: string; jobId: string; error: string }> = [];

    for (const [oldName, newName] of Object.entries(mapping)) {
      const jobIds = await readJobIds(connection, oldName);
      if (jobIds.length === 0) continue;

      console.log(`  ${oldName} → ${newName}: ${jobIds.length} jobs`);
      const result = await copyJobs(connection, oldName, newName);
      console.log(`    → copied: ${result.copied}, already done: ${result.alreadyCopied}, skipped: ${result.skipped}, failed: ${result.failed.length}`);

      totalCopied += result.copied;
      totalSkipped += result.skipped;
      totalAlreadyCopied += result.alreadyCopied;
      for (const f of result.failed) {
        allFailures.push({ queue: oldName, ...f });
      }
    }

    console.log("");
    console.log(`Summary: ${totalCopied} copied, ${totalAlreadyCopied} already done, ${totalSkipped} skipped, ${allFailures.length} failed`);

    if (allFailures.length > 0) {
      console.log("");
      console.log("Failures:");
      for (const f of allFailures) {
        console.log(`  ${f.queue}:${f.jobId} — ${f.error}`);
      }
      console.log("");
      console.log("Re-run --migrate to retry failed jobs (already-copied jobs will be skipped).");
    } else {
      console.log("");
      console.log("All jobs copied successfully. Old keys are still in Redis.");
      console.log("Verify new queues look correct, then run:");
      console.log("  npx tsx scripts/migrate-queue-names.ts --cleanup");
    }
  }

  // Phase 3: Delete old keys and migration tracker (if --cleanup)
  if (cleanup) {
    console.log("");
    console.log("Deleting old keys...");
    await cleanupKeys(connection, allOldKeys);
    console.log(`  → deleted ${allOldKeys.length} keys`);

    // Remove the migration tracker set
    await connection.unlink(MIGRATION_TRACKER_KEY);
    console.log("  → removed migration tracker");
  }

  // Phase 4: Dry-run instructions
  if (!migrate && !cleanup) {
    console.log("");
    console.log("Step 1 — Copy jobs to new queues (safe, no deletion):");
    console.log("  npx tsx scripts/migrate-queue-names.ts --migrate");
    console.log("");
    console.log("Step 2 — After verifying, delete old keys:");
    console.log("  npx tsx scripts/migrate-queue-names.ts --cleanup");
  }

  await connection.quit();
}

// Only run main() when executed directly (not when imported by tests)
const isDirectExecution = process.argv[1]?.includes("migrate-queue-names");

if (isDirectExecution) {
  main().catch((err) => {
    console.error("Migration failed:", err);
    process.exit(1);
  });
}
