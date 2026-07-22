import type { Cluster, Redis as IORedis } from "ioredis";

import { createTenantId } from "~/server/event-sourcing/domain/tenantId";
import {
  blobHolderSetKey,
  blobLeaseSetKey,
  redisBlobKey,
  redisBlobKeyPrefix,
} from "~/server/event-sourcing/queues/groupQueue/blobKeys";
import {
  BLOB_SWEEP_LUA,
  type BlobSweepOutcome,
} from "~/server/event-sourcing/queues/groupQueue/blobSweepLua";
import {
  type BlobSweepReport,
  BlobSweeper,
} from "~/server/event-sourcing/queues/groupQueue/blobSweeper";
import { CachedLuaScript } from "~/server/event-sourcing/queues/groupQueue/cachedLuaScript";
import { GROUP_QUEUE_REGISTRY_KEY } from "~/server/event-sourcing/queues/groupQueue/scripts";

import type {
  BlobStoreRepository,
  OpsBlobPage,
  OpsBlobStoreStats,
  OpsBlobSummary,
} from "./blob-store.repository";

/** Dry-run eval, so the browser reports the same verdict the runner would act on. */
const previewScript = new CachedLuaScript(BLOB_SWEEP_LUA);

/** Hard ceiling on a page regardless of what the caller asks for. */
const MAX_PAGE = 200;

/**
 * SCAN pages are approximate: Redis returns "up to COUNT" per call and the
 * cursor is the only way to resume. Walking until a page is exactly full could
 * mean many round trips on a sparse keyspace, so a page is bounded by BOTH the
 * requested limit and a fixed number of SCAN calls.
 */
const MAX_SCAN_CALLS_PER_PAGE = 20;

function isCluster(client: IORedis | Cluster): client is Cluster {
  return typeof (client as Cluster).nodes === "function";
}

export class BlobStoreRedisRepository implements BlobStoreRepository {
  private readonly redis: IORedis | Cluster;
  private readonly sweeper: BlobSweeper;

  constructor(redis: IORedis | Cluster) {
    this.redis = redis;
    this.sweeper = new BlobSweeper({ redis });
  }

  async findAllQueueNames(): Promise<string[]> {
    return (await this.redis.smembers(GROUP_QUEUE_REGISTRY_KEY)).sort();
  }

  /**
   * Cursor pagination straight off SCAN.
   *
   * In cluster mode SCAN is per-node, so the cursor is a JSON map of node → its
   * own cursor. That keeps the walk resumable without ever materialising the
   * whole keyspace, which is the only way this is safe to expose to a browser
   * against a production instance.
   */
  async findAll({
    queueName,
    cursor,
    limit,
    projectId,
  }: {
    queueName: string;
    cursor?: string | null;
    limit: number;
    projectId?: string | null;
  }): Promise<OpsBlobPage> {
    const pageSize = Math.min(Math.max(limit, 1), MAX_PAGE);
    const prefix = redisBlobKeyPrefix(queueName);
    // Filtering by project narrows in Redis rather than in Node, so a tenant
    // lookup on a large keyspace does not stream every other tenant's keys back.
    const pattern = projectId ? `${prefix}${projectId}/*` : `${prefix}*/*`;

    const cursors: Record<string, string> = cursor
      ? (JSON.parse(cursor) as Record<string, string>)
      : {};
    const nodes: Array<{ id: string; client: { scan: IORedis["scan"] } }> =
      isCluster(this.redis)
        ? this.redis
            .nodes("master")
            .map((node, index) => ({ id: String(index), client: node }))
        : [{ id: "0", client: this.redis }];

    const keys: string[] = [];
    const nextCursors: Record<string, string> = {};

    for (const node of nodes) {
      let nodeCursor = cursors[node.id] ?? "0";
      // A node already exhausted on a previous page stays exhausted.
      if (cursor && !(node.id in cursors)) continue;
      let calls = 0;
      do {
        const [next, batch] = await node.client.scan(
          nodeCursor,
          "MATCH",
          pattern,
          "COUNT",
          Math.min(pageSize * 2, 512),
        );
        nodeCursor = next;
        keys.push(...batch);
        calls += 1;
      } while (
        nodeCursor !== "0" &&
        keys.length < pageSize &&
        calls < MAX_SCAN_CALLS_PER_PAGE
      );
      if (nodeCursor !== "0") nextCursors[node.id] = nodeCursor;
    }

    const page = keys.slice(0, pageSize);
    const blobs = await this.describe(queueName, page);
    return {
      blobs,
      nextCursor:
        Object.keys(nextCursors).length > 0 ? JSON.stringify(nextCursors) : null,
    };
  }

  async findById({
    queueName,
    projectId,
    hash,
  }: {
    queueName: string;
    projectId: string;
    hash: string;
  }): Promise<OpsBlobSummary | null> {
    const key = redisBlobKey({
      queueName,
      projectId: createTenantId(projectId),
      hash,
    });
    const [summary] = await this.describe(queueName, [key]);
    return summary ?? null;
  }

  /** Batches the per-blob reads so a page of 200 is a handful of round trips, not 800. */
  private async describe(
    queueName: string,
    keys: string[],
  ): Promise<OpsBlobSummary[]> {
    if (keys.length === 0) return [];
    const prefix = redisBlobKeyPrefix(queueName);
    const parsed = keys
      .map((key) => {
        const suffix = key.slice(prefix.length);
        const slash = suffix.indexOf("/");
        if (slash <= 0 || slash === suffix.length - 1) return null;
        return {
          key,
          projectId: suffix.slice(0, slash),
          hash: suffix.slice(slash + 1),
        };
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

    const pipeline = this.redis.pipeline();
    for (const entry of parsed) {
      const keyArgs = {
        queueName,
        projectId: createTenantId(entry.projectId),
        hash: entry.hash,
      };
      pipeline.strlen(entry.key);
      pipeline.ttl(entry.key);
      pipeline.zcard(blobLeaseSetKey(keyArgs));
      pipeline.scard(blobHolderSetKey(keyArgs));
    }
    const results = (await pipeline.exec()) ?? [];

    const summaries: OpsBlobSummary[] = [];
    for (const [index, entry] of parsed.entries()) {
      const base = index * 4;
      const num = (offset: number): number => {
        const value = results[base + offset]?.[1];
        return typeof value === "number" ? value : Number(value ?? 0);
      };
      const ttl = num(1);
      const holders = num(3);
      summaries.push({
        queueName,
        projectId: entry.projectId,
        hash: entry.hash,
        sizeBytes: num(0),
        ttlSeconds: ttl < 0 ? null : ttl,
        liveLeases: num(2),
        // The sentinel is bookkeeping, not a holder, so showing it would make
        // every blob look referenced by one phantom.
        holderTokens: Math.max(holders - 1, 0),
        sweepOutcome: await this.previewOutcome(queueName, entry),
      });
    }
    return summaries;
  }

  /** Runs the sweep decision in dry-run so the UI never disagrees with the runner. */
  private async previewOutcome(
    queueName: string,
    entry: { key: string; projectId: string; hash: string },
  ): Promise<BlobSweepOutcome | "unknown"> {
    const keyArgs = {
      queueName,
      projectId: createTenantId(entry.projectId),
      hash: entry.hash,
    };
    try {
      return String(
        await previewScript.run(
          this.redis,
          3,
          blobLeaseSetKey(keyArgs),
          blobHolderSetKey(keyArgs),
          entry.key,
          "1",
        ),
      ) as BlobSweepOutcome;
    } catch {
      return "unknown";
    }
  }

  async getStats({
    sampleLimit,
  }: {
    sampleLimit: number;
  }): Promise<OpsBlobStoreStats> {
    const queues: OpsBlobStoreStats["queues"] = [];
    for (const queueName of await this.findAllQueueNames()) {
      const page = await this.findAll({ queueName, limit: sampleLimit });
      queues.push({
        queueName,
        sampledBlobs: page.blobs.length,
        sampledBytes: page.blobs.reduce((sum, b) => sum + b.sizeBytes, 0),
        unreferenced: page.blobs.filter((b) => b.liveLeases === 0).length,
        // Says out loud that the numbers are a sample, so nobody reads them as a total.
        truncated: page.nextCursor !== null,
      });
    }
    return { queues };
  }

  async deleteOne({
    queueName,
    projectId,
    hash,
  }: {
    queueName: string;
    projectId: string;
    hash: string;
  }): Promise<boolean> {
    const keyArgs = {
      queueName,
      projectId: createTenantId(projectId),
      hash,
    };
    const removed = await this.redis.unlink(redisBlobKey(keyArgs));
    await this.redis.del(blobLeaseSetKey(keyArgs), blobHolderSetKey(keyArgs));
    return removed > 0;
  }

  async runCleanup({ dryRun }: { dryRun: boolean }): Promise<BlobSweepReport> {
    return this.sweeper.sweep({ dryRun });
  }
}
