#!/usr/bin/env npx tsx
/**
 * Migration script for BullMQ queue name changes.
 *
 * When queue names change (e.g., "event-sourcing" → "{event_sourcing}"),
 * BullMQ creates new Redis keys. Jobs under old key names become orphaned
 * and will never be processed because workers now listen on new names.
 *
 * This script:
 *   1. Discovers old queues by scanning Redis for pre-hash-tag key patterns
 *   2. Reads job data from old queues using raw Redis commands
 *      (single-key ops work on both standalone and cluster)
 *   3. Re-adds jobs to the corresponding new hash-tagged queue via BullMQ
 *   4. Cleans up old keys after migration
 *
 * Usage:
 *   npx tsx scripts/migrate-queue-names.ts              # Dry-run (report only)
 *   npx tsx scripts/migrate-queue-names.ts --migrate     # Move jobs → new queues, cleanup old
 *   npx tsx scripts/migrate-queue-names.ts --cleanup     # Delete old keys (no job move)
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
// BullMQ key suffixes — used to identify queue names from raw Redis keys
// ---------------------------------------------------------------------------

const BULLMQ_KEY_SUFFIXES = [
  "wait",
  "active",
  "completed",
  "failed",
  "delayed",
  "paused",
  "stalled",
  "meta",
  "id",
  "events",
  "priority",
  "pc", // priority counter
  "marker",
] as const;

const BULLMQ_SUFFIX_SET = new Set<string>(BULLMQ_KEY_SUFFIXES);

/** Lists/sets that contain job IDs worth migrating. */
const JOB_LISTS = ["wait", "delayed", "active"] as const;

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
): Promise<{ name: string; data: unknown; opts: Record<string, unknown> } | null> {
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
 * Moves jobs from an old queue to a new hash-tagged queue.
 *
 * Reads job data using raw Redis commands (works on cluster for single-key ops),
 * then re-adds via BullMQ Queue.add() (works on cluster because new names have hash tags).
 *
 * Returns the number of jobs moved.
 */
export async function moveJobs(
  connection: IORedis | Cluster,
  oldQueueName: string,
  newQueueName: string,
): Promise<number> {
  const jobIds = await readJobIds(connection, oldQueueName);
  if (jobIds.length === 0) return 0;

  const newQueue = new Queue(newQueueName, {
    connection: connection as any,
  });

  let moved = 0;
  try {
    for (const jobId of jobIds) {
      const job = await readJobData(connection, oldQueueName, jobId);
      if (!job) continue;

      await newQueue.add(job.name, job.data, {
        // Preserve relevant options but let BullMQ assign a new job ID
        delay: (job.opts.delay as number) ?? undefined,
        priority: (job.opts.priority as number) ?? undefined,
        attempts: (job.opts.attempts as number) ?? undefined,
        backoff: job.opts.backoff as any,
      });
      moved++;
    }
  } finally {
    await newQueue.close();
  }

  return moved;
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
    process.exit(1);
  }

  const mode = migrate ? "MIGRATE" : cleanup ? "CLEANUP" : "DRY-RUN";
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

  // Phase 2: Migrate jobs (if --migrate)
  if (migrate) {
    console.log("");
    console.log("Moving jobs from old queues to new hash-tagged queues...");

    const mapping = await buildQueueMapping(connection);
    let totalMoved = 0;

    for (const [oldName, newName] of Object.entries(mapping)) {
      const jobIds = await readJobIds(connection, oldName);
      if (jobIds.length === 0) continue;

      console.log(`  ${oldName} → ${newName}: ${jobIds.length} jobs`);
      const moved = await moveJobs(connection, oldName, newName);
      console.log(`    → moved ${moved} jobs`);
      totalMoved += moved;
    }

    console.log("");
    console.log(`Total: ${totalMoved} jobs moved`);
  }

  // Phase 3: Cleanup old keys (if --migrate or --cleanup)
  if (migrate || cleanup) {
    console.log("");
    console.log("Cleaning up old keys...");
    await cleanupKeys(connection, allOldKeys);
    console.log(`  → deleted ${allOldKeys.length} keys`);
  }

  // Phase 4: Dry-run instructions
  if (!migrate && !cleanup) {
    console.log("");
    console.log("To move jobs to new queues and clean up:");
    console.log("  npx tsx scripts/migrate-queue-names.ts --migrate");
    console.log("");
    console.log("To just delete old keys (jobs will be lost):");
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
