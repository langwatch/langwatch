import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  _resetMemoryEmailCapStore,
  consumeEmailCapSlot,
} from "../emailHourlyCap";

// `connection` is a mutable module-level binding; the mock lets each test
// drive it (undefined = in-memory path, an object = Redis path).
const redisMock = vi.hoisted(() => ({
  connection: undefined as unknown,
}));
vi.mock("~/server/redis", () => redisMock);

// Stable singleton logger so a test can spy the SAME `error` fn the module
// captured at import time (`const logger = createLogger(...)` runs once).
const loggerMock = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));
vi.mock("~/utils/logger/server", () => ({
  createLogger: () => loggerMock,
}));

// Redis `connection` is undefined under vitest (BUILD_TIME set in
// vitest.config.ts), so these exercise the in-memory fallback path.

const PROJECT_ID = "proj-1";
const TRIGGER_ID = "trig-1";

describe("consumeEmailCapSlot in-memory fallback", () => {
  beforeEach(() => {
    _resetMemoryEmailCapStore();
  });

  describe("given Redis is connected but errors mid-call", () => {
    afterEach(() => {
      redisMock.connection = undefined;
    });

    describe("when incr throws", () => {
      it("falls back to the in-memory counter and still returns a sane slot", async () => {
        redisMock.connection = {
          set: vi.fn().mockResolvedValue("OK"),
          get: vi.fn(),
          incr: vi.fn().mockRejectedValue(new Error("READONLY blip")),
          expire: vi.fn(),
        };

        const now = new Date("2026-06-11T10:15:00Z");
        const result = await consumeEmailCapSlot({
          projectId: PROJECT_ID,
          triggerId: TRIGGER_ID,
          now,
          cap: 3,
          dedupKey: "proj-1/trig-1:digest:abc",
        });

        // Redis path threw → memory fallback started a fresh count.
        expect(result).toEqual({ allowed: true, count: 1 });
      });
    });

    describe("when Redis fails on every call (sustained outage)", () => {
      it("logs at error and the in-memory counter accumulates across the fallback rather than resetting", async () => {
        loggerMock.error.mockClear();
        // `set` permanently rejects, so every call throws before touching the
        // counter and lands in the in-memory fallback. A unique dedupKey per
        // call ensures each fallback consumption wins its claim (no retry
        // collapse) — we are proving the counter accumulates, not the claim.
        redisMock.connection = {
          set: vi.fn().mockRejectedValue(new Error("connection refused")),
          get: vi.fn().mockRejectedValue(new Error("connection refused")),
          incr: vi.fn().mockRejectedValue(new Error("connection refused")),
          expire: vi.fn().mockRejectedValue(new Error("connection refused")),
        };

        const now = new Date("2026-06-11T10:15:00Z");
        const cap = 3;
        const results = [];
        // Call cap + 1 times — the last must be over the cap, proving the
        // per-worker counter kept climbing through the outage.
        for (let i = 0; i < cap + 1; i++) {
          results.push(
            await consumeEmailCapSlot({
              projectId: PROJECT_ID,
              triggerId: TRIGGER_ID,
              now,
              cap,
              dedupKey: `proj-1/trig-1:digest:sustained-${i}`,
            }),
          );
        }

        expect(results.map((r) => r.count)).toEqual([1, 2, 3, 4]);
        expect(results[cap]).toEqual({ allowed: false, count: 4 });
        // Degraded-cap visibility (FIX): the fallback logs at ERROR, not warn.
        expect(loggerMock.error).toHaveBeenCalled();
      });
    });
  });

  describe("given Redis is connected", () => {
    afterEach(() => {
      redisMock.connection = undefined;
    });

    describe("when consecutive distinct dispatches hit the same hour key", () => {
      it("re-applies the TTL with NX on every hit (no immortal-key leak)", async () => {
        const expire = vi.fn().mockResolvedValue(1);
        let counter = 0;
        redisMock.connection = {
          // Distinct dedupKeys → both claims win → both reach INCR + expire.
          set: vi.fn().mockResolvedValue("OK"),
          get: vi.fn().mockResolvedValue(null),
          incr: vi.fn().mockImplementation(async () => ++counter),
          expire,
        };

        const now = new Date("2026-06-11T10:15:00Z");
        await consumeEmailCapSlot({
          projectId: PROJECT_ID,
          triggerId: TRIGGER_ID,
          now,
          cap: 3,
          dedupKey: "proj-1/trig-1:digest:d1",
        });
        await consumeEmailCapSlot({
          projectId: PROJECT_ID,
          triggerId: TRIGGER_ID,
          now,
          cap: 3,
          dedupKey: "proj-1/trig-1:digest:d2",
        });

        // expire is attempted on BOTH hits, with the NX flag, so a transient
        // first-hit failure can't leave the key without a TTL.
        expect(expire).toHaveBeenCalledTimes(2);
        for (const call of expire.mock.calls) {
          expect(call[0]).toMatch(/^trigger-email-cap:/);
          expect(call[1]).toBe(7200);
          expect(call[2]).toBe("NX");
        }
      });
    });

    describe("when the SAME dispatch is retried (claim already won)", () => {
      it("re-reads the counter without a second INCR so a retry never burns a cap slot", async () => {
        const incr = vi.fn().mockResolvedValue(1);
        // SET NX: first call wins ("OK"), retry loses (null). The retry must
        // GET the current count instead of INCR-ing it again.
        const set = vi
          .fn()
          .mockResolvedValueOnce("OK")
          .mockResolvedValueOnce(null);
        redisMock.connection = {
          set,
          get: vi.fn().mockResolvedValue("1"),
          incr,
          expire: vi.fn().mockResolvedValue(1),
        };

        const now = new Date("2026-06-11T10:15:00Z");
        const args = {
          projectId: PROJECT_ID,
          triggerId: TRIGGER_ID,
          now,
          cap: 3,
          dedupKey: "proj-1/trig-1:digest:retry-me",
        };
        const first = await consumeEmailCapSlot(args);
        const retry = await consumeEmailCapSlot(args);

        // INCR fired once (the won claim); the retry only re-read via GET.
        expect(incr).toHaveBeenCalledTimes(1);
        expect(first).toEqual({ allowed: true, count: 1 });
        expect(retry).toEqual({ allowed: true, count: 1 });
      });
    });
  });

  describe("given a fresh hour bucket", () => {
    describe("when the SAME dispatch is consumed twice (outbox retry)", () => {
      it("does not double-count: the second call re-reads the same slot", async () => {
        const now = new Date("2026-06-11T10:15:00Z");
        const args = {
          projectId: PROJECT_ID,
          triggerId: TRIGGER_ID,
          now,
          cap: 3,
          dedupKey: "proj-1/trig-1:digest:retry-mem",
        };
        const first = await consumeEmailCapSlot(args);
        const retry = await consumeEmailCapSlot(args);
        // A third, DIFFERENT dispatch advances the counter — proving the first
        // retry was suppressed by the claim gate, not by a frozen counter.
        const other = await consumeEmailCapSlot({
          ...args,
          dedupKey: "proj-1/trig-1:digest:other-mem",
        });

        expect(first).toEqual({ allowed: true, count: 1 });
        expect(retry).toEqual({ allowed: true, count: 1 });
        expect(other).toEqual({ allowed: true, count: 2 });
      });
    });

    describe("when dispatches arrive under the cap", () => {
      it("allows them and counts up monotonically", async () => {
        const now = new Date("2026-06-11T10:15:00Z");
        const first = await consumeEmailCapSlot({
          projectId: PROJECT_ID,
          triggerId: TRIGGER_ID,
          now,
          cap: 3,
          dedupKey: "proj-1/trig-1:digest:m1",
        });
        const second = await consumeEmailCapSlot({
          projectId: PROJECT_ID,
          triggerId: TRIGGER_ID,
          now,
          cap: 3,
          dedupKey: "proj-1/trig-1:digest:m2",
        });

        expect(first).toEqual({ allowed: true, count: 1 });
        expect(second).toEqual({ allowed: true, count: 2 });
      });
    });

    describe("when a dispatch pushes the count past the cap", () => {
      it("reports the slot as not allowed", async () => {
        const now = new Date("2026-06-11T10:15:00Z");
        for (let i = 0; i < 2; i++) {
          await consumeEmailCapSlot({
            projectId: PROJECT_ID,
            triggerId: TRIGGER_ID,
            now,
            cap: 2,
            dedupKey: `proj-1/trig-1:digest:over-${i}`,
          });
        }
        const overCap = await consumeEmailCapSlot({
          projectId: PROJECT_ID,
          triggerId: TRIGGER_ID,
          now,
          cap: 2,
          dedupKey: "proj-1/trig-1:digest:over-final",
        });

        expect(overCap).toEqual({ allowed: false, count: 3 });
      });
    });
  });

  describe("given the cap was exhausted in the previous hour", () => {
    describe("when a dispatch arrives in the next hour bucket", () => {
      it("starts a fresh count and allows it again", async () => {
        const firstHour = new Date("2026-06-11T10:59:00Z");
        await consumeEmailCapSlot({
          projectId: PROJECT_ID,
          triggerId: TRIGGER_ID,
          now: firstHour,
          cap: 1,
          dedupKey: "proj-1/trig-1:digest:h1-a",
        });
        const overCapSameHour = await consumeEmailCapSlot({
          projectId: PROJECT_ID,
          triggerId: TRIGGER_ID,
          now: firstHour,
          cap: 1,
          dedupKey: "proj-1/trig-1:digest:h1-b",
        });
        expect(overCapSameHour.allowed).toBe(false);

        const nextHour = new Date("2026-06-11T11:00:00Z");
        const rolledOver = await consumeEmailCapSlot({
          projectId: PROJECT_ID,
          triggerId: TRIGGER_ID,
          now: nextHour,
          cap: 1,
          dedupKey: "proj-1/trig-1:digest:h2-a",
        });

        expect(rolledOver).toEqual({ allowed: true, count: 1 });
      });
    });
  });

  describe("given a dispatch lands exactly at the cap", () => {
    describe("when count equals cap", () => {
      it("reports the slot as allowed (<= boundary)", async () => {
        const now = new Date("2026-06-11T10:15:00Z");
        await consumeEmailCapSlot({
          projectId: PROJECT_ID,
          triggerId: TRIGGER_ID,
          now,
          cap: 2,
          dedupKey: "proj-1/trig-1:digest:bound-a",
        });
        const atCap = await consumeEmailCapSlot({
          projectId: PROJECT_ID,
          triggerId: TRIGGER_ID,
          now,
          cap: 2,
          dedupKey: "proj-1/trig-1:digest:bound-b",
        });

        expect(atCap).toEqual({ allowed: true, count: 2 });
      });
    });
  });

  describe("given two distinct triggers in the same project", () => {
    describe("when each dispatches in the same hour", () => {
      it("counts them independently", async () => {
        const now = new Date("2026-06-11T10:15:00Z");
        const a = await consumeEmailCapSlot({
          projectId: PROJECT_ID,
          triggerId: "trig-a",
          now,
          cap: 1,
          dedupKey: "proj-1/trig-a:digest:x",
        });
        const b = await consumeEmailCapSlot({
          projectId: PROJECT_ID,
          triggerId: "trig-b",
          now,
          cap: 1,
          dedupKey: "proj-1/trig-b:digest:x",
        });

        expect(a).toEqual({ allowed: true, count: 1 });
        expect(b).toEqual({ allowed: true, count: 1 });
      });
    });
  });
});
