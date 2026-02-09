#!/usr/bin/env npx tsx
/**
 * Migration script for BullMQ queue name changes.
 *
 * When queue names change (e.g., "event-sourcing" → "{event_sourcing}"),
 * BullMQ creates new Redis keys. Jobs under old key names become orphaned
 * and will never be processed.
 *
 * This script:
 *   1. Scans Redis for keys matching OLD queue name patterns
 *   2. Reports what it finds (counts per queue)
 *   3. Optionally deletes orphaned keys with --cleanup flag
 *
 * Usage:
 *   npx tsx scripts/migrate-queue-names.ts              # Dry-run (report only)
 *   npx tsx scripts/migrate-queue-names.ts --cleanup     # Delete orphaned keys
 *
 * Environment:
 *   REDIS_URL or REDIS_CLUSTER_ENDPOINTS must be set.
 */

import IORedis, { Cluster } from "ioredis";

const OLD_QUEUE_PATTERNS = [
  // Background worker queues (already migrated on main, but check anyway)
  "bull:collector:*",
  "bull:evaluations:*",
  "bull:topic_clustering:*",
  "bull:track_events:*",
  "bull:usage_stats:*",
  // Event sourcing worker
  "bull:event-sourcing:*",
  // Pipeline queues (handler, projection, command)
  "bull:trace_processing/*",
  "bull:evaluation_processing/*",
  // Scenario queue
  "bull:simulations/scenarios/executions:*",
];

function createConnection(): IORedis | Cluster {
  const clusterEndpoints = process.env.REDIS_CLUSTER_ENDPOINTS;
  const redisUrl = process.env.REDIS_URL;

  if (clusterEndpoints) {
    const endpoints = clusterEndpoints.split(",").map((raw) => {
      const url = raw.includes("://") ? new URL(raw) : new URL(`redis://${raw}`);
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

async function scanKeys(
  connection: IORedis | Cluster,
  pattern: string,
): Promise<string[]> {
  const keys: string[] = [];

  if (connection instanceof Cluster) {
    // Cluster: scan each master node
    const masters = connection.nodes("master");
    for (const node of masters) {
      let cursor = "0";
      do {
        const [next, batch] = await node.scan(cursor, "MATCH", pattern, "COUNT", 100);
        cursor = next;
        keys.push(...batch);
      } while (cursor !== "0");
    }
  } else {
    let cursor = "0";
    do {
      const [next, batch] = await connection.scan(cursor, "MATCH", pattern, "COUNT", 100);
      cursor = next;
      keys.push(...batch);
    } while (cursor !== "0");
  }

  return keys;
}

async function main() {
  const cleanup = process.argv.includes("--cleanup");

  console.log(cleanup ? "Mode: CLEANUP (will delete orphaned keys)" : "Mode: DRY-RUN (report only)");
  console.log("");

  const connection = createConnection();

  let totalOrphaned = 0;

  for (const pattern of OLD_QUEUE_PATTERNS) {
    const keys = await scanKeys(connection, pattern);
    if (keys.length > 0) {
      console.log(`  ${pattern}: ${keys.length} keys`);
      totalOrphaned += keys.length;

      if (cleanup) {
        // Use UNLINK for async deletion (non-blocking) and batch for throughput
        const BATCH_SIZE = 100;
        for (let i = 0; i < keys.length; i += BATCH_SIZE) {
          const batch = keys.slice(i, i + BATCH_SIZE);
          await Promise.all(batch.map((key) => connection.unlink(key)));
          if (keys.length > BATCH_SIZE) {
            console.log(`    … ${Math.min(i + BATCH_SIZE, keys.length)}/${keys.length} deleted`);
          }
        }
        console.log(`    → deleted ${keys.length} keys`);
      }
    }
  }

  if (totalOrphaned === 0) {
    console.log("No orphaned keys found. Migration is clean.");
  } else {
    console.log("");
    console.log(`Total: ${totalOrphaned} orphaned keys`);
    if (!cleanup) {
      console.log("");
      console.log("Run with --cleanup to delete them:");
      console.log("  npx tsx scripts/migrate-queue-names.ts --cleanup");
    }
  }

  await connection.quit();
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
