import { createHash } from "node:crypto";

import type { Cluster, Redis as IORedis } from "ioredis";

/**
 * EVALSHA wrapper for a Lua script whose source is sent once, not per call.
 *
 * The queue's scripts are large — STAGE is ~11 KB and DISPATCH ~22 KB once the
 * shared helpers are prepended — and run at four-digit rates, so plain EVAL
 * re-transfers and re-hashes the full source on every call (measured at ~33%
 * of the prod Redis engine CPU, 2026-07-09). EVALSHA sends the 40-byte sha1
 * instead; on a NOSCRIPT miss (empty script cache after a restart or
 * SCRIPT FLUSH, or the first call against a cluster node) it falls back to
 * EVAL once, which loads the script into that node's cache for every later
 * call.
 *
 * The sha is derived from the source, so a deploy that changes a script can
 * never execute a stale cached body — a different source is a different sha.
 * Keys stay hash-tagged by the caller exactly as with EVAL, so cluster slot
 * routing is unchanged.
 */
export class CachedLuaScript {
  private readonly source: string;
  private readonly sha: string;

  constructor(source: string) {
    this.source = source;
    this.sha = createHash("sha1").update(source).digest("hex");
  }

  async run(
    redis: IORedis | Cluster,
    numKeys: number,
    ...keysAndArgs: Array<string | number>
  ): Promise<unknown> {
    try {
      return await redis.evalsha(this.sha, numKeys, ...keysAndArgs);
    } catch (err) {
      if (err instanceof Error && err.message.includes("NOSCRIPT")) {
        return await redis.eval(this.source, numKeys, ...keysAndArgs);
      }
      throw err;
    }
  }
}
