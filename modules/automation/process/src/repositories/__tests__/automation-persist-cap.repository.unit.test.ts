import { Temporal } from "@langwatch/time";
import { describe, expect, it, vi } from "vitest";

import { MemoryAutomationPersistCapRepository } from "../memory/memory.automation-persist-cap.repository.ts";
import { RedisAutomationPersistCapRepository } from "../redis/redis.automation-persist-cap.repository.ts";

const PROJECT_ID = "proj-1";
const TRIGGER_ID = "trig-1";
const NOW = Temporal.Instant.from("2026-08-09T12:00:00.000Z");

const slot = (traceId: string) => ({
  projectId: PROJECT_ID,
  triggerId: TRIGGER_ID,
  now: NOW,
  dedupKey: `${PROJECT_ID}/${TRIGGER_ID}:persist:${traceId}`,
});

describe("given the two keys one Lua script touches together", () => {
  describe("when their Redis Cluster slots are compared", () => {
    /** @scenario "The ceiling survives a clustered Redis" */
    it("routes both to one slot by sharing a hash tag", () => {
      const hashTag = (key: string) => key.match(/\{([^}]*)\}/)?.[1];
      const counter = RedisAutomationPersistCapRepository.counterKey(slot("trace-1"));
      const claim = RedisAutomationPersistCapRepository.claimKey(slot("trace-1"));

      expect(hashTag(counter)).toBe(`${PROJECT_ID}:${TRIGGER_ID}`);
      expect(hashTag(claim)).toBe(hashTag(counter));
    });
  });
});

describe("given a Redis that answers", () => {
  describe("when a slot is consumed", () => {
    it("answers the fleet-wide count Redis returned", async () => {
      const slots = RedisAutomationPersistCapRepository.create({
        connection: { eval: vi.fn().mockResolvedValue(7), get: vi.fn() },
        logger: { error: vi.fn(), warn: vi.fn() },
      });

      expect(await slots.consumeSlot(slot("trace-1"))).toEqual({ outcome: "counted", count: 7 });
    });
  });

  describe("when the list reads counts", () => {
    it("answers every requested trigger, zero where no counter exists", async () => {
      const get = vi.fn(async (key: string) => (key.includes(TRIGGER_ID) ? "3" : null));
      const slots = RedisAutomationPersistCapRepository.create({
        connection: { eval: vi.fn(), get },
        logger: { error: vi.fn(), warn: vi.fn() },
      });

      expect(
        await slots.findCounts({
          projectId: PROJECT_ID,
          triggerIds: [TRIGGER_ID, "quiet"],
          now: NOW,
        }),
      ).toEqual([
        { triggerId: TRIGGER_ID, count: 3 },
        { triggerId: "quiet", count: 0 },
      ]);
    });
  });
});

describe("given a Redis that cannot be reached", () => {
  const unreachable = () =>
    RedisAutomationPersistCapRepository.create({
      connection: {
        eval: vi.fn().mockRejectedValue(new Error("ECONNREFUSED")),
        get: vi.fn().mockRejectedValue(new Error("ECONNREFUSED")),
      },
      logger: { error: vi.fn(), warn: vi.fn() },
    });

  describe("when slots are consumed", () => {
    /** @scenario "An unreachable Redis degrades the ceiling to per-worker counting" */
    it("answers degraded and keeps counting per worker, once per dispatch", async () => {
      const slots = unreachable();

      expect(await slots.consumeSlot(slot("trace-1"))).toEqual({ outcome: "degraded", count: 1 });
      expect(await slots.consumeSlot(slot("trace-1"))).toEqual({ outcome: "degraded", count: 1 });
      expect(await slots.consumeSlot(slot("trace-2"))).toEqual({ outcome: "degraded", count: 2 });
    });
  });

  describe("when the list reads counts", () => {
    /** @scenario "The automations list does not hide an unreachable counter store" */
    it("propagates the failure instead of showing no skipped matches", async () => {
      await expect(
        unreachable().findCounts({ projectId: PROJECT_ID, triggerIds: [TRIGGER_ID], now: NOW }),
      ).rejects.toThrow("ECONNREFUSED");
    });
  });
});

describe("given the memory tier", () => {
  describe("when a dispatch is consumed and its retry presented", () => {
    it("counts the dispatch once and reads it back", async () => {
      const slots = MemoryAutomationPersistCapRepository.create();

      await slots.consumeSlot(slot("trace-1"));
      await slots.consumeSlot(slot("trace-1"));
      await slots.consumeSlot(slot("trace-2"));

      expect(
        await slots.findCounts({
          projectId: PROJECT_ID,
          triggerIds: [TRIGGER_ID, "quiet"],
          now: NOW,
        }),
      ).toEqual([
        { triggerId: TRIGGER_ID, count: 2 },
        { triggerId: "quiet", count: 0 },
      ]);
    });
  });
});
