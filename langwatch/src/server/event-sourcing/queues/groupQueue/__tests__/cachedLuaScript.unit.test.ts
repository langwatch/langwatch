import { describe, expect, it, vi } from "vitest";
import type { Redis as IORedis } from "ioredis";

import { CachedLuaScript } from "../cachedLuaScript";

function makeRedis({ cacheHit }: { cacheHit: boolean }) {
  const evalsha = vi.fn(async () => {
    if (!cacheHit) throw new Error("NOSCRIPT No matching script.");
    return "sha-result";
  });
  const evalFn = vi.fn(async () => "eval-result");
  return {
    redis: { evalsha, eval: evalFn } as unknown as IORedis,
    evalsha,
    evalFn,
  };
}

describe("CachedLuaScript", () => {
  describe("given the script is already in the server's cache", () => {
    it("runs via EVALSHA without sending the source", async () => {
      const { redis, evalsha, evalFn } = makeRedis({ cacheHit: true });
      const script = new CachedLuaScript("return 1");

      const result = await script.run(redis, 1, "key", "arg");

      expect(result).toBe("sha-result");
      expect(evalsha).toHaveBeenCalledWith(
        expect.stringMatching(/^[0-9a-f]{40}$/),
        1,
        "key",
        "arg",
      );
      expect(evalFn).not.toHaveBeenCalled();
    });
  });

  describe("given an empty script cache (restart / SCRIPT FLUSH / new cluster node)", () => {
    it("falls back to EVAL once, loading the script for later calls", async () => {
      const { redis, evalsha, evalFn } = makeRedis({ cacheHit: false });
      const script = new CachedLuaScript("return 1");

      const result = await script.run(redis, 1, "key", "arg");

      expect(result).toBe("eval-result");
      expect(evalsha).toHaveBeenCalledOnce();
      expect(evalFn).toHaveBeenCalledWith("return 1", 1, "key", "arg");
    });
  });

  describe("given the script itself errors", () => {
    it("propagates the error instead of retrying via EVAL", async () => {
      const evalsha = vi.fn(async () => {
        throw new Error("ERR user_script:1: attempt to index a nil value");
      });
      const evalFn = vi.fn();
      const script = new CachedLuaScript("return nil.x");

      await expect(
        script.run({ evalsha, eval: evalFn } as unknown as IORedis, 0),
      ).rejects.toThrow("attempt to index a nil value");
      expect(evalFn).not.toHaveBeenCalled();
    });
  });

  describe("given two scripts with different sources", () => {
    it("derives distinct shas so a changed script can never hit a stale cache entry", async () => {
      const a = makeRedis({ cacheHit: true });
      const b = makeRedis({ cacheHit: true });
      await new CachedLuaScript("return 1").run(a.redis, 0);
      await new CachedLuaScript("return 2").run(b.redis, 0);

      expect(a.evalsha.mock.calls[0]?.[0]).not.toBe(
        b.evalsha.mock.calls[0]?.[0],
      );
    });
  });
});
