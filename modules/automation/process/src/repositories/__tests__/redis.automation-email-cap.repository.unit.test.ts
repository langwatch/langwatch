import { describe, expect, it, vi } from "vitest";

import { RedisAutomationEmailCapRepository } from "../redis/redis.automation-email-cap.repository.ts";

function connectionAnswering(setReply: "OK" | null) {
  return {
    set: vi.fn().mockResolvedValue(setReply),
    get: vi.fn().mockResolvedValue("4"),
    incr: vi.fn().mockResolvedValue(5),
    incrby: vi.fn().mockResolvedValue(9),
    eval: vi.fn().mockResolvedValue(1),
  };
}

describe("given the email ceilings counted on Redis", () => {
  describe("when a claim key is set for the first time", () => {
    it("reports the claim as taken, with the expiry and NX condition it was asked for", async () => {
      const connection = connectionAnswering("OK");
      const caps = RedisAutomationEmailCapRepository.create({ connection });

      expect(await caps.claim("cap-claimed:k", "1", "EX", 7200, "NX")).toBe("claimed");
      expect(connection.set).toHaveBeenCalledWith("cap-claimed:k", "1", "EX", 7200, "NX");
    });
  });

  describe("when the claim key already exists", () => {
    it("reports the claim as already taken", async () => {
      const caps = RedisAutomationEmailCapRepository.create({
        connection: connectionAnswering(null),
      });

      expect(await caps.claim("cap-claimed:k", "1", "EX", 7200, "NX")).toBe("already-claimed");
    });
  });

  describe("when a counter is read and advanced", () => {
    it("answers what Redis answered", async () => {
      const connection = connectionAnswering("OK");
      const caps = RedisAutomationEmailCapRepository.create({ connection });

      expect(await caps.findValue("counter")).toBe("4");
      expect(await caps.incr("counter")).toBe(5);
      expect(await caps.incrby("counter", 4)).toBe(9);
      expect(await caps.eval("script", 1, "counter", "3600")).toBe(1);
      expect(connection.eval).toHaveBeenCalledWith("script", 1, "counter", "3600");
    });
  });
});
