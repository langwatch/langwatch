import { createHash } from "node:crypto";

import type { ChainableCommander, Cluster, Redis as IORedis } from "ioredis";

/**
 * EVALSHA wrapper: send sha once (NOSCRIPT miss falls back to EVAL to warm cache).
 * Avoids re-transferring/re-hashing large scripts at high call rates.
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
    ...keysAndArgs: (string | number)[]
  ): Promise<unknown> {
    return this.runCancellable(redis, null, numKeys, ...keysAndArgs);
  }

  /**
   * Like {@link run} but cancellable: NOSCRIPT fallback is issued after await
   * (ordering risk for stale commands; isCancelled closes the window).
   */
  async runCancellable(
    redis: IORedis | Cluster,
    isCancelled: (() => boolean) | null,
    numKeys: number,
    ...keysAndArgs: (string | number)[]
  ): Promise<unknown> {
    try {
      return await redis.evalsha(this.sha, numKeys, ...keysAndArgs);
    } catch (err) {
      if (isNoScript(err)) {
        if (isCancelled?.()) return null;
        return redis.eval(this.source, numKeys, ...keysAndArgs);
      }
      throw err;
    }
  }

  /**
   * Queue into pipeline (no NOSCRIPT fallback; caller handles error via
   * {@link isNoScriptResult} and re-runs with {@link run} to warm cache).
   */
  queue(pipeline: ChainableCommander, numKeys: number, ...keysAndArgs: (string | number)[]): void {
    pipeline.evalsha(this.sha, numKeys, ...keysAndArgs);
  }
}

function isNoScript(err: unknown): boolean {
  return err instanceof Error && err.message.startsWith("NOSCRIPT");
}

/** True when a pipelined result failed only because the node had no cached copy. */
export function isNoScriptResult(result: [Error | null, unknown] | undefined): boolean {
  return isNoScript(result?.[0]);
}
