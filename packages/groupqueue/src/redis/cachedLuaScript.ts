import { createHash } from "node:crypto";

/** The subset of an ioredis client this package's scripts need — small
 * enough to satisfy with a fake in a unit test. */
export interface LuaRunner {
  evalsha(
    sha: string,
    numKeys: number,
    ...keysAndArgs: (string | number)[]
  ): Promise<unknown>;
  eval(
    source: string,
    numKeys: number,
    ...keysAndArgs: (string | number)[]
  ): Promise<unknown>;
}

function isNoScript(err: unknown): boolean {
  return err instanceof Error && err.message.startsWith("NOSCRIPT");
}

/**
 * EVALSHA wrapper: sends the 40-byte sha instead of the full source on every
 * call, falling back to EVAL once on a `NOSCRIPT` miss (empty script cache
 * after a restart, or a first call against a cluster node) — which also
 * loads the source into that node's cache for every later call.
 */
export class CachedLuaScript {
  private readonly sha: string;

  constructor(private readonly source: string) {
    this.sha = createHash("sha1").update(source).digest("hex");
  }

  async run(
    redis: LuaRunner,
    numKeys: number,
    ...keysAndArgs: (string | number)[]
  ): Promise<unknown> {
    try {
      return await redis.evalsha(this.sha, numKeys, ...keysAndArgs);
    } catch (err) {
      if (!isNoScript(err)) throw err;
      return await redis.eval(this.source, numKeys, ...keysAndArgs);
    }
  }
}
