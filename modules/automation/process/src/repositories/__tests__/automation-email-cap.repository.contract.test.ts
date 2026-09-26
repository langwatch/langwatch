import {
  type MemoryRedisStore,
  memoryRedisDouble,
  memoryRedisStore,
} from "@langwatch/test-harness/client-doubles/redis";
import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import type {
  AutomationEmailCapRepository,
  EmailCapSend,
} from "../automation-email-cap.repository.ts";
import { MemoryAutomationEmailCapRepository } from "../memory/memory.automation-email-cap.repository.ts";
import { RedisAutomationEmailCapRepository } from "../redis/redis.automation-email-cap.repository.ts";

const NOW = Temporal.Instant.from("2026-06-11T10:15:00Z");

function send(overrides: Partial<EmailCapSend> = {}): EmailCapSend {
  return {
    window: "trigger-email-cap:project-1:trigger-1:494298",
    claim: "cap-claimed:dispatch-1",
    sends: 1,
    ttlSeconds: 7_200,
    now: NOW,
    ...overrides,
  };
}

/** Redis's counter commands the double does not carry, answered from its own keyspace. */
function redisOver(store: MemoryRedisStore): RedisAutomationEmailCapRepository {
  const connection = memoryRedisDouble({
    store,
    script: {
      incrby: async (key: unknown, increment: unknown) => {
        const count = Number(store.strings.get(String(key)) ?? "0") + Number(increment);
        store.strings.set(String(key), String(count));
        return count;
      },
      eval: async (_script: unknown, _keys: unknown, key: unknown, seconds: unknown) => {
        if (!store.expiries.has(String(key))) {
          store.expiries.set(String(key), Number(seconds) * 1_000);
        }
        return null;
      },
    },
  });
  return RedisAutomationEmailCapRepository.create({ connection });
}

const backends: [string, () => AutomationEmailCapRepository][] = [
  ["memory", () => MemoryAutomationEmailCapRepository.create()],
  ["redis", () => redisOver(memoryRedisStore())],
];

describe.each(backends)("given the %s email cap counters", (_name, open) => {
  describe("when a dispatch claims its sends for the first time", () => {
    it("counts them into the window and answers the window's count", async () => {
      const caps = open();

      expect(await caps.claimSend(send({ sends: 4 }))).toEqual({ outcome: "counted", count: 4 });
      expect(await caps.countSends({ window: send().window, now: NOW })).toBe(4);
    });
  });

  describe("when the same dispatch claims again", () => {
    it("counts nothing a second time", async () => {
      const caps = open();
      await caps.claimSend(send());

      expect(await caps.claimSend(send())).toEqual({ outcome: "already-counted" });
      expect(await caps.countSends({ window: send().window, now: NOW })).toBe(1);
    });
  });

  describe("when distinct dispatches claim into one window", () => {
    it("accumulates their sends", async () => {
      const caps = open();
      await caps.claimSend(send({ claim: "cap-claimed:a", sends: 6 }));

      expect(await caps.claimSend(send({ claim: "cap-claimed:b", sends: 6 }))).toEqual({
        outcome: "counted",
        count: 12,
      });
    });
  });

  describe("when two windows are counted", () => {
    it("keeps them apart", async () => {
      const caps = open();
      await caps.claimSend(send({ window: "window-a", claim: "claim-a" }));
      await caps.claimSend(send({ window: "window-b", claim: "claim-b" }));

      expect(await caps.countSends({ window: "window-a", now: NOW })).toBe(1);
      expect(await caps.countSends({ window: "window-b", now: NOW })).toBe(1);
    });
  });

  describe("when a window nothing was counted into is read", () => {
    it("answers zero", async () => {
      expect(await open().countSends({ window: "never-counted", now: NOW })).toBe(0);
    });
  });
});

describe("given the memory email cap counters", () => {
  describe("when the window and its claim have lapsed", () => {
    it("starts a fresh window and accepts the claim again", async () => {
      const caps = MemoryAutomationEmailCapRepository.create();
      await caps.claimSend(send({ sends: 3 }));
      const later = NOW.add({ seconds: 7_201 });

      expect(await caps.countSends({ window: send().window, now: later })).toBe(0);
      expect(await caps.claimSend(send({ now: later }))).toEqual({ outcome: "counted", count: 1 });
    });
  });
});

describe("given the redis email cap counters", () => {
  describe("when a dispatch is counted", () => {
    it("holds the claim and the window for the requested seconds", async () => {
      const store = memoryRedisStore();
      await redisOver(store).claimSend(send());

      expect(store.expiries.get("cap-claimed:dispatch-1")).toBe(7_200_000);
      expect(store.expiries.get(send().window)).toBe(7_200_000);
    });
  });
});
