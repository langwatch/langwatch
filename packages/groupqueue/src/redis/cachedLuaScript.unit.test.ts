import { describe, expect, it, vi } from "vitest";
import { CachedLuaScript, type LuaRunner } from "./cachedLuaScript";

function noScriptError(): Error {
  return new Error("NOSCRIPT No matching script. Please use EVAL.");
}

describe("CachedLuaScript", () => {
  describe("given a Redis client that raises NOSCRIPT on evalsha", () => {
    /** @scenario A NOSCRIPT reply falls back to EVAL with the cached source */
    it("retries with EVAL and returns the result", async () => {
      const script = new CachedLuaScript("return 1");
      const redis: LuaRunner = {
        evalsha: vi.fn().mockRejectedValue(noScriptError()),
        eval: vi.fn().mockResolvedValue("eval-result"),
      };

      const result = await script.run(redis, 1, "key1", "arg1");

      expect(result).toBe("eval-result");
      expect(redis.eval).toHaveBeenCalledWith("return 1", 1, "key1", "arg1");
    });

    it("does not retry a plain non-NOSCRIPT error", async () => {
      const script = new CachedLuaScript("return 1");
      const redis: LuaRunner = {
        evalsha: vi.fn().mockRejectedValue(new Error("WRONGTYPE not a set")),
        eval: vi.fn(),
      };

      await expect(script.run(redis, 1, "key1")).rejects.toThrow("WRONGTYPE");
      expect(redis.eval).not.toHaveBeenCalled();
    });
  });

  it("sends evalsha with the sha1 of the source, not the source itself", async () => {
    const script = new CachedLuaScript("return 1");
    const redis: LuaRunner = {
      evalsha: vi.fn().mockResolvedValue("ok"),
      eval: vi.fn(),
    };

    await script.run(redis, 0);

    const sha = (redis.evalsha as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as string;
    expect(sha).toMatch(/^[0-9a-f]{40}$/);
  });
});
