import { createHash } from "node:crypto";

import type { ChainableCommander, Cluster, Redis as IORedis } from "ioredis";

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
      if (isNoScript(err)) {
        return await redis.eval(this.source, numKeys, ...keysAndArgs);
      }
      throw err;
    }
  }

  /**
   * Queues one invocation onto a pipeline, so N runs cost one round trip
   * instead of N.
   *
   * There is no NOSCRIPT fallback inside a pipeline — a queued command cannot
   * retry itself — so the caller has to recognise that error on the result and
   * re-run it through {@link run}, which loads the source and warms the cache
   * for every later call. {@link isNoScriptResult} is that check.
   */
  queue(
    pipeline: ChainableCommander,
    numKeys: number,
    ...keysAndArgs: Array<string | number>
  ): void {
    pipeline.evalsha(this.sha, numKeys, ...keysAndArgs);
  }
}

function isNoScript(err: unknown): boolean {
  return err instanceof Error && err.message.startsWith("NOSCRIPT");
}

/** True when a pipelined result failed only because the node had no cached copy. */
export function isNoScriptResult(
  result: [Error | null, unknown] | undefined,
): boolean {
  return isNoScript(result?.[0]);
}
