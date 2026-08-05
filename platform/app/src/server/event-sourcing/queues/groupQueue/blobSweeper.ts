import { createLogger } from "@langwatch/observability";
import type { Cluster, Redis as IORedis } from "ioredis";

import { createTenantId } from "~/server/event-sourcing/domain/tenantId";

import {
  blobHolderSetKey,
  blobLeaseSetKey,
  redisBlobKeyPrefix,
} from "./blobKeys";
import {
  BLOB_SWEEP_LUA,
  BLOB_SWEEP_OUTCOMES,
  type BlobSweepOutcome,
} from "./blobSweepLua";
import { CachedLuaScript } from "./cachedLuaScript";
import { gqBlobSweepTotal } from "./metrics";
import { GROUP_QUEUE_REGISTRY_KEY } from "./scripts";

const logger = createLogger("langwatch:group-queue:blob-sweeper");

const sweepScript = new CachedLuaScript(BLOB_SWEEP_LUA);

/** SCAN page size. Large enough to keep round trips down, small enough not to block Redis. */
const SCAN_COUNT = 256;

/**
 * Ceiling on blobs examined per queue per sweep, so one pass can never turn into
 * an unbounded walk of a multi-million-key keyspace. Work not reached this tick
 * is reached the next one; the sweep is periodic, not transactional.
 *
 * That promise only holds because the SCAN cursor is carried across ticks (see
 * {@link blobSweepCursorKey}). A ceiling on a walk that always restarts at the
 * beginning is not a rate limit, it is a blind spot: it would pin every sweep to
 * the same leading slice of the keyspace and leave everything past it to the
 * backstop TTL, however often the sweep ran.
 */
const DEFAULT_MAX_KEYS_PER_QUEUE = 50_000;

/**
 * Ceiling on SCAN calls per queue per sweep, bounding the walk by work done
 * rather than by matches found.
 *
 * The matched-key ceiling alone does not bound a tick: SCAN pages by buckets and
 * `MATCH` filters afterwards, so when few keys match, a tick walks the entire
 * keyspace to collect its quota however large that keyspace is — the cost is
 * paid whether or not anything comes back. `COUNT` is a work hint, not a
 * guarantee, so the number of calls to cross a keyspace is not fixed either.
 * Stopping on either ceiling makes one tick's cost bounded in both regimes, and
 * the parked cursor means the budget defers work rather than dropping it.
 */
const DEFAULT_MAX_SCAN_CALLS_PER_QUEUE = 2_000;

/**
 * Where the last sweep of a queue stopped, so the next one resumes there instead
 * of re-walking the slice it already judged.
 *
 * A SCAN cursor stays valid indefinitely, so parking one between ticks is safe:
 * a full cycle still returns every key that exists for the whole of it. Keys
 * created mid-cycle may not be seen until the following one, which is the normal
 * SCAN guarantee and is what a periodic reclaim pass already assumes.
 *
 * It lives in Redis rather than in the process so progress survives a restart
 * and is shared by whichever pod runs the tick. One field per node, because in
 * cluster mode each master is iterated separately and a cursor only means
 * anything against the node that issued it.
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
  queues: Array<{ queueName: string } & BlobSweepTally>;
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
 * SCAN is a keyless command, so ioredis cannot derive a slot for it and routes a
 * cluster call to an arbitrary node. The queue's hash tag co-slots the KEYS a
 * script touches but does nothing for iteration, so the fan-out over masters is
 * required for correctness, not throughput.
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
 * Walks the GQ2 blob keyspace and bounds the retention of blobs nothing
 * references, independently of whether a release ever ran for them.
 *
 * The release grace window can only act at the moment a lease is retired. A
 * holder killed mid-flight never retires one, so its blob keeps the full
 * backstop and is re-armed on every redelivery; worse, the token it leaves in
 * the holder set makes the next clean release read the blob as still held and
 * withhold the window from every job sharing that content. This runner judges a
 * blob on its own lease state instead, which is the only view that survives a
 * holder dying without a release.
 *
 * See `blobSweepLua.ts` for why repair may shorten a deadline the release path
 * would not, and why reclaim is the only pass allowed to destroy bytes.
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
    return names.sort();
  }

  /**
   * Matches `<queueName>:gq:blob:<projectId>/<hash>`.
   *
   * The glob requires a slash, and that is what selects GQ2 only: a GQ1 blob is
   * keyed by a bare randomUUID with no slash, and it is privately owned by one
   * staged value rather than content-addressed, so it is not this runner's to
   * judge. `projectId` never contains a slash and the hash is base64url, so a
   * GQ2 key splits on exactly one.
   */
  private blobScanPattern(queueName: string): string {
    return `${redisBlobKeyPrefix(queueName)}*/*`;
  }

  private parseBlobKey(
    queueName: string,
    key: string,
  ): { projectId: string; hash: string } | null {
    const suffix = key.slice(redisBlobKeyPrefix(queueName).length);
    const slash = suffix.indexOf("/");
    if (slash <= 0 || slash === suffix.length - 1) return null;
    return {
      projectId: suffix.slice(0, slash),
      hash: suffix.slice(slash + 1),
    };
  }

  /**
   * Read this queue's blob keys, resuming from the parked cursor.
   *
   * Returns where each node stopped rather than storing it: the cursor is only
   * safe to advance once the blobs it covers have actually been judged, so the
   * caller commits it after the sweep and never on a dry run. Advancing here
   * would let a dry run — or a sweep that died before judging the batch — skip
   * that slice until the cursor wrapped all the way around.
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
      const parsed = this.parseBlobKey(queueName, key);
      // A key that does not split into exactly one projectId/hash pair is not a
      // GQ2 blob whatever the glob matched. Skip rather than guess at its shape.
      if (!parsed) continue;
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
        if (!BLOB_SWEEP_OUTCOMES.includes(outcome)) continue;
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
    const startedAt = Date.now();
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
      durationMs: Date.now() - startedAt,
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
