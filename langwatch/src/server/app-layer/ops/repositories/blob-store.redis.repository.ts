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
  OpsBlobPage,
  OpsBlobSort,
  OpsBlobStoreStats,
  OpsBlobSummary,
} from "../types";
import type { BlobStoreRepository } from "./blob-store.repository";

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

/**
 * How many blobs a ranked listing may examine before it ranks what it has.
 *
 * There is no index over size / TTL / lease state, so ranking means describing
 * blobs one page at a time. This bounds that work at a few thousand pipelined
 * reads — enough that "largest" and "unreferenced" surface the real offenders
 * on a healthy instance, and bounded enough that it cannot become a scan of a
 * multi-million-key keyspace on a sick one.
 */
const RANK_SAMPLE_CAP = 5_000;

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
    sort = "scan",
  }: {
    queueName: string;
    cursor?: string | null;
    limit: number;
    projectId?: string | null;
    sort?: OpsBlobSort;
  }): Promise<OpsBlobPage> {
    if (sort !== "scan") {
      return this.findRanked({ queueName, limit, projectId, sort });
    }
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
      sampled: blobs.length,
      rankedFromSample: false,
    };
  }

  /**
   * Ranked listing: read a bounded sample, order it, return the head.
   *
   * There is no index to sort by — size, TTL and lease state all live on
   * separate keys — so a true global top-N would mean describing every blob in
   * the keyspace on every request. The sample cap is the deliberate ceiling on
   * that, and `rankedFromSample` tells the caller when the answer is
   * "largest of what we looked at" rather than "largest that exists". Silently
   * presenting the former as the latter is how an operator chases the wrong
   * blob.
   */
  private async findRanked({
    queueName,
    limit,
    projectId,
    sort,
  }: {
    queueName: string;
    limit: number;
    projectId?: string | null;
    sort: OpsBlobSort;
  }): Promise<OpsBlobPage> {
    const pageSize = Math.min(Math.max(limit, 1), MAX_PAGE);
    const sample: OpsBlobSummary[] = [];
    let cursor: string | null = null;
    let exhausted = false;

    while (sample.length < RANK_SAMPLE_CAP) {
      const page: OpsBlobPage = await this.findAll({
        queueName,
        cursor,
        limit: MAX_PAGE,
        projectId,
        sort: "scan",
      });
      sample.push(...page.blobs);
      cursor = page.nextCursor;
      if (!cursor) {
        exhausted = true;
        break;
      }
    }

    const now = Date.now();
    const byLapsedLease = (blob: OpsBlobSummary): number =>
      // Future deadlines are live leases, not lapses; sort them last.
      blob.earliestLeaseDeadlineMs === null ||
      blob.earliestLeaseDeadlineMs > now
        ? Number.POSITIVE_INFINITY
        : blob.earliestLeaseDeadlineMs;

    const ranked = [...sample];
    switch (sort) {
      case "largest":
        ranked.sort((a, b) => b.sizeBytes - a.sizeBytes);
        break;
      case "stalest":
        // A null TTL means no expiry at all, which outlives every finite one.
        ranked.sort(
          (a, b) =>
            (a.ttlSeconds ?? Number.POSITIVE_INFINITY) -
            (b.ttlSeconds ?? Number.POSITIVE_INFINITY),
        );
        break;
      case "unreferenced":
        ranked.sort(
          (a, b) => a.liveLeases - b.liveLeases || b.sizeBytes - a.sizeBytes,
        );
        break;
      case "oldest_lapsed_lease":
        ranked.sort((a, b) => byLapsedLease(a) - byLapsedLease(b));
        break;
      default:
        break;
    }

    return {
      blobs: ranked.slice(0, pageSize),
      // Ranking consumes its own sample, so there is no resumable cursor: a
      // "next page" of a best-of-sample would not mean anything.
      nextCursor: null,
      sampled: sample.length,
      rankedFromSample: !exhausted,
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
      // Lowest score in the lease set: the earliest deadline, which dates the
      // oldest lapse once it is in the past.
      pipeline.zrange(blobLeaseSetKey(keyArgs), 0, 0, "WITHSCORES");
    }
    const results = (await pipeline.exec()) ?? [];

    const summaries: OpsBlobSummary[] = [];
    for (const [index, entry] of parsed.entries()) {
      const base = index * 5;
      const num = (offset: number): number => {
        const value = results[base + offset]?.[1];
        return typeof value === "number" ? value : Number(value ?? 0);
      };
      const ttl = num(1);
      const holders = num(3);
      const earliest = results[base + 4]?.[1];
      const earliestScore = Array.isArray(earliest)
        ? Number((earliest as string[])[1])
        : Number.NaN;
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
        earliestLeaseDeadlineMs: Number.isFinite(earliestScore)
          ? earliestScore
          : null,
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

  async findStats({
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
