/**
 * The export slot claim over Redis: one `SET key value EX seconds NX` per claim, so a held
 * slot refuses and a crashed export's slot frees itself when its TTL runs out.
 * @vitest-environment node
 */
import { memoryRedisDouble } from "@langwatch/test-harness/client-doubles/redis";
import { describe, expect, it } from "vitest";

import { RedisTraceExportSlotRepository } from "../redis.trace-export-slot.repository.ts";

describe("RedisTraceExportSlotRepository", () => {
  describe("given a free key", () => {
    it("claims it as SET key value EX seconds NX", async () => {
      const calls: unknown[][] = [];
      const connection = memoryRedisDouble({
        script: {
          set: async (...args: unknown[]) => {
            calls.push(args);
            return "OK";
          },
        },
      });
      const slots = RedisTraceExportSlotRepository.create({ connection });

      await expect(slots.claim("trace-export:slot:project-1:0", "export-1", 600)).resolves.toBe(
        true,
      );
      expect(calls[0]).toEqual(["trace-export:slot:project-1:0", "export-1", "EX", 600, "NX"]);
    });
  });

  describe("given a held key", () => {
    it("refuses the second claim until the first is freed", async () => {
      const slots = RedisTraceExportSlotRepository.create({ connection: memoryRedisDouble() });

      await slots.claim("slot", "export-1", 600);

      await expect(slots.claim("slot", "export-2", 600)).resolves.toBe(false);
      await slots.del("slot");
      await expect(slots.claim("slot", "export-2", 600)).resolves.toBe(true);
    });
  });
});
