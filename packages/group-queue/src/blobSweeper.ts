import { createLogger } from "@langwatch/observability";
import { nowInstant } from "@langwatch/time";
import type { Cluster, Redis as IORedis } from "ioredis";

import { blobHolderSetKey, blobLeaseSetKey, redisBlobKeyPrefix } from "./blobKeys.ts";
import { BLOB_SWEEP_LUA, BLOB_SWEEP_OUTCOMES, type BlobSweepOutcome } from "./blobSweepLua.ts";
import { CachedLuaScript } from "./cachedLuaScript.ts";
import { gqBlobSweepTotal } from "./metrics.ts";
import { GROUP_QUEUE_REGISTRY_KEY } from "./scripts.ts";
import { createTenantId } from "./storage.ts";

const logger = createLogger("langwatch:group-queue:blob-sweeper");

const sweepScript = new CachedLuaScript(BLOB_SWEEP_LUA);

/** SCAN page size. Large enough to keep round trips down, small enough not to block Redis. */
const SCAN_COUNT = 256;

/**
 * Ceiling on blobs per tick (persistent SCAN cursor defers work, not drops it).
 */
const DEFAULT_MAX_KEYS_PER_QUEUE = 50_000;

/**
 * Ceiling on SCAN calls per tick (bounds work when few keys match the filter).
 */
const DEFAULT_MAX_SCAN_CALLS_PER_QUEUE = 2_000;

/**
 * Parked SCAN cursor (persisted in Redis, per-node in cluster mode, survives restart).
 */
function blobSweepCursorKey(queueName: string): string {
  return `${queueName}:gq:blob-sweep-cursor`;
}

/** Cursor field for a non-clustered client, which has exactly one keyspace. */
const SINGLE_NODE_CURSOR_FIELD = "single";

export interface BlobSweepTally extends Record<BlobSweepOutcome, number> {
  /** Blobs examined, i.e. the sum of every outcome. */
  scanned: number;
  /**
   * True when the per-queue ceiling stopped the walk before the keyspace ended.
   * The next tick resumes from where this one stopped, so on a keyspace larger
   * than the ceiling this is the steady state, not a fault.
   */
  truncated: boolean;
}

export interface BlobSweepReport {
  queues: ({ queueName: string } & BlobSweepTally)[];
  totals: BlobSweepTally;
  dryRun: boolean;
  durationMs: number;
}

function emptyTally(): BlobSweepTally {
  const tally = { scanned: 0, truncated: false } as BlobSweepTally;
  for (const outcome of BLOB_SWEEP_OUTCOMES) tally[outcome] = 0;
  return tally;
}

function isCluster(client: IORedis | Cluster): client is Cluster {
  return typeof (client as Cluster).nodes === "function";
}

/**
 * SCAN is keyless, so ioredis can't derive a slot and routes a cluster call
 * to an arbitrary node. The queue's hash tag co-slots script KEYS but does
 * nothing for iteration, so fan-out over masters is for correctness, not throughput.
 */
async function scanNode(params: {
  node: { scan: IORedis["scan"] };
  pattern: string;
  limit: number;
  callBudget: number;
  /** Cursor the previous tick stopped at; "0" starts a fresh cycle. */
  cursor: string;
}): Promise<{ keys: string[]; cursor: string; truncated: boolean }> {
  const keys: string[] = [];
  let cursor = params.cursor;
  let calls = 0;
  do {
    const [nextCursor, batch] = await params.node.scan(
      cursor,
      "MATCH",
      params.pattern,
      "COUNT",
      SCAN_COUNT,
    );
    cursor = nextCursor;
    calls += 1;
    keys.push(...batch);
    // Every key the cursor has moved past is kept, so the batch that crosses a
    // ceiling is not trimmed. Trimming it would drop keys the returned cursor has
    // already passed, and the next tick — resuming from that cursor — would never
    // come back for them. Overshooting the ceiling by at most one page is the
    // cheaper side of that trade.
    if (keys.length >= params.limit || calls >= params.callBudget) {
      return { keys, cursor, truncated: true };
    }
  } while (cursor !== "0");
  return { keys, cursor: "0", truncated: false };
}

/**
 * Bound blob retention independently of release (grace window only acts at lease
 * retirement, but killed holders never retire; judge by lease state instead).
 */
export class BlobSweeper {
  private readonly redis: IORedis | Cluster;
  private readonly maxKeysPerQueue: number;

  private readonly maxScanCallsPerQueue: number;

  constructor({
    redis,
    maxKeysPerQueue = DEFAULT_MAX_KEYS_PER_QUEUE,
    maxScanCallsPerQueue = DEFAULT_MAX_SCAN_CALLS_PER_QUEUE,
  }: {
    redis: IORedis | Cluster;
    maxKeysPerQueue?: number;
    maxScanCallsPerQueue?: number;
  }) {
    this.redis = redis;
    this.maxKeysPerQueue = maxKeysPerQueue;
    this.maxScanCallsPerQueue = maxScanCallsPerQueue;
  }

  /** Queue names the group queue has registered itself under. */
  async listQueueNames(): Promise<string[]> {
    const names = await this.redis.smembers(GROUP_QUEUE_REGISTRY_KEY);
    return names.toSorted();
  }

  /**
   * Matches `<queueName>:gq:blob:<projectId>/<hash>`. The slash is the
   * tenant/hash separator — `projectId` never contains one and the hash is
   * base64url, so a canonical blob key splits on exactly one.
   */
  private blobScanPattern(queueName: string): string {
    return `${redisBlobKeyPrefix(queueName)}*/*`;
  }

  private parseBlobKey(queueName: string, key: string): { projectId: string; hash: string } | null {
    const suffix = key.slice(redisBlobKeyPrefix(queueName).length);
    const slash = suffix.indexOf("/");
    if (slash <= 0 || slash === suffix.length - 1) return null;
    return {
      projectId: suffix.slice(0, slash),
      hash: suffix.slice(slash + 1),
    };
  }

  private async sweepBlobKey({
    dryRun,
    key,
    queueName,
    tally,
  }: {
    dryRun: boolean;
    key: string;
    queueName: string;
    tally: BlobSweepTally;
  }): Promise<void> {
    const parsed = this.parseBlobKey(queueName, key);
    // A key that does not split into exactly one projectId/hash pair is not a
    // GQ2 blob whatever the glob matched. Skip rather than guess at its shape.
    if (!parsed) return;
    const { projectId, hash } = parsed;
    // The brand exists so a caller cannot namespace a blob with an arbitrary
    // user-controlled string. Minting here is legitimate: this value was read
    // back out of a key the queue itself wrote, not off a request.
    const keyArgs = {
      queueName,
      projectId: createTenantId(projectId),
      hash,
    };
    try {
      const outcome = String(
        await sweepScript.run(
          this.redis,
          3,
          blobLeaseSetKey(keyArgs),
          blobHolderSetKey(keyArgs),
          key,
          dryRun ? "1" : "0",
        ),
      ) as BlobSweepOutcome;
      if (!BLOB_SWEEP_OUTCOMES.includes(outcome)) return;
      tally[outcome] += 1;
      tally.scanned += 1;
      if (!dryRun) {
        gqBlobSweepTotal.inc({ queue_name: queueName, outcome });
      }
    } catch (err) {
      // One unreadable blob must not abort the sweep. The cursor still moves
      // past it, so it is retried when the cursor next comes around rather
      // than on the next tick — deliberately, because holding the cursor for a
      // blob that fails every time would stall the whole walk behind it. Its
      // bytes stay bounded by the backstop TTL in the meantime.
      logger.warn(
        {
          queueName,
          blobHash: hash,
          err: err instanceof Error ? err.message : String(err),
        },
        "Blob sweep failed for one blob; continuing",
      );
    }
  }

  /**
   * Read blob keys resuming from parked cursor; return cursor state for caller to
   * commit only after judging (advances only on real sweep, not dry run).
   */
  private async scanBlobKeys(queueName: string): Promise<{
    keys: string[];
    truncated: boolean;
    resumeFrom: Record<string, string>;
  }> {
    const pattern = this.blobScanPattern(queueName);
    const parked = await this.redis.hgetall(blobSweepCursorKey(queueName));

    if (!isCluster(this.redis)) {
      const result = await scanNode({
        node: this.redis,
        pattern,
        limit: this.maxKeysPerQueue,
        callBudget: this.maxScanCallsPerQueue,
        cursor: parked[SINGLE_NODE_CURSOR_FIELD] ?? "0",
      });
      return {
        keys: result.keys,
        truncated: result.truncated,
        resumeFrom: { [SINGLE_NODE_CURSOR_FIELD]: result.cursor },
      };
    }

    const seen = new Set<string>();
    const resumeFrom: Record<string, string> = {};
    let truncated = false;
    const nodes = this.redis.nodes("master");
    await Promise.all(
      nodes.map(async (node) => {
        const nodeField = `${node.options.host ?? "?"}:${node.options.port ?? "?"}`;
        const result = await scanNode({
          node,
          pattern,
          limit: this.maxKeysPerQueue,
          callBudget: this.maxScanCallsPerQueue,
          cursor: parked[nodeField] ?? "0",
        });
        if (result.truncated) truncated = true;
        resumeFrom[nodeField] = result.cursor;
        for (const key of result.keys) seen.add(key);
      }),
    );
    return { keys: Array.from(seen), truncated, resumeFrom };
  }

  async sweepQueue({
    queueName,
    dryRun = false,
  }: {
    queueName: string;
    dryRun?: boolean;
  }): Promise<BlobSweepTally> {
    const tally = emptyTally();
    const { keys, truncated, resumeFrom } = await this.scanBlobKeys(queueName);
    tally.truncated = truncated;

    for (const key of keys) {
      await this.sweepBlobKey({ dryRun, key, queueName, tally });
    }

    // Commit the cursor only now, and never for a dry run: until the blobs this
    // page covers have actually been judged, advancing past them would skip them
    // for a whole cycle. A sweep that dies before here leaves the cursor where it
    // was and the next tick re-judges the same page, which is idempotent.
    if (!dryRun && Object.keys(resumeFrom).length > 0) {
      await this.redis.hset(blobSweepCursorKey(queueName), resumeFrom);
    }
    return tally;
  }

  async sweep({
    dryRun = false,
  }: {
    dryRun?: boolean;
  } = {}): Promise<BlobSweepReport> {
    const startedAt = nowInstant().epochMilliseconds;
    const totals = emptyTally();
    const queues: BlobSweepReport["queues"] = [];

    for (const queueName of await this.listQueueNames()) {
      const tally = await this.sweepQueue({ queueName, dryRun });
      queues.push({ queueName, ...tally });
      totals.scanned += tally.scanned;
      totals.truncated ||= tally.truncated;
      for (const outcome of BLOB_SWEEP_OUTCOMES) {
        totals[outcome] += tally[outcome];
      }
    }

    const report: BlobSweepReport = {
      queues,
      totals,
      dryRun,
      durationMs: nowInstant().epochMilliseconds - startedAt,
    };
    if (totals.reclaimed > 0 || totals.repaired > 0 || totals.truncated) {
      logger.info(
        {
          dryRun,
          scanned: totals.scanned,
          repaired: totals.repaired,
          reclaimed: totals.reclaimed,
          bookkeeping: totals.bookkeeping,
          truncated: totals.truncated,
          durationMs: report.durationMs,
        },
        // Truncation is reported so the covered fraction of a large keyspace
        // stays visible: one tick judges a slice, and the cycle is only as fast
        // as the ceiling and the interval together allow.
        "Blob sweep completed",
      );
    }
    return report;
  }
}
