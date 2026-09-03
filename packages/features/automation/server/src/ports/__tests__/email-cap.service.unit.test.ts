import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AutomationEmailCapService,
  type ConsumeDailyEmailCapInput,
  type ConsumeHourlyEmailCapInput,
} from "../../services/email-cap.service";
import type { AutomationEmailCapStorePort } from "../email-cap.port";

// The package accepts the infrastructure connection explicitly. This holder
// keeps the test's Redis-vs-memory choice local without a process-global App.
const redisMock = vi.hoisted(() => ({
  connection: undefined as AutomationEmailCapStorePort | undefined,
}));

function makeStore(overrides: Partial<AutomationEmailCapStorePort>): AutomationEmailCapStorePort {
  return {
    trySet: vi.fn().mockResolvedValue("OK"),
    tryGet: vi.fn().mockResolvedValue(null),
    incr: vi.fn().mockResolvedValue(1),
    incrby: vi.fn().mockResolvedValue(1),
    eval: vi.fn().mockResolvedValue(null),
    ...overrides,
  };
}

let service = AutomationEmailCapService.create({ store: null });
let serviceStore: AutomationEmailCapStorePort | null = null;

function emailCapService(): AutomationEmailCapService {
  const store = redisMock.connection ?? null;
  if (store !== serviceStore) {
    service = AutomationEmailCapService.create({ store });
    serviceStore = store;
  }

  return service;
}

const consumeEmailCapSlot = (input: ConsumeHourlyEmailCapInput) =>
  emailCapService().consumeHourly(input);

const consumeTenantEmailCapSlot = (input: ConsumeDailyEmailCapInput) =>
  emailCapService().consumeDaily(input);

// Stable singleton logger so a test can spy the SAME `error` fn the module
// captured at import time (`const logger = createLogger(...)` runs once).
const loggerMock = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));
vi.mock("@langwatch/observability", () => ({
  createLogger: () => loggerMock,
}));

// The holder starts empty, so a test that does not set it exercises the
// in-memory fallback path.

const PROJECT_ID = "proj-1";
const TRIGGER_ID = "trig-1";

beforeEach(() => {
  redisMock.connection = undefined;
  serviceStore = null;
  service = AutomationEmailCapService.create({ store: null });
});

describe("consumeEmailCapSlot in-memory fallback", () => {
  describe("given Redis is connected but errors mid-call", () => {
    afterEach(() => {
      redisMock.connection = undefined;
    });

    describe("when incr throws", () => {
      it("falls back to the in-memory counter and still returns a sane slot", async () => {
        redisMock.connection = makeStore({
          trySet: vi.fn().mockResolvedValue("OK"),
          tryGet: vi.fn(),
          incr: vi.fn().mockRejectedValue(new Error("READONLY blip")),
          eval: vi.fn(),
        });

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
        redisMock.connection = makeStore({
          trySet: vi.fn().mockRejectedValue(new Error("connection refused")),
          tryGet: vi.fn().mockRejectedValue(new Error("connection refused")),
          incr: vi.fn().mockRejectedValue(new Error("connection refused")),
          eval: vi.fn().mockRejectedValue(new Error("connection refused")),
        });

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
      it("re-attempts the TTL on every hit, through one single-key script", async () => {
        const evalFn = vi.fn().mockResolvedValue(null);
        let counter = 0;
        redisMock.connection = makeStore({
          // Distinct dedupKeys → both claims win → both reach INCR + expire.
          trySet: vi.fn().mockResolvedValue("OK"),
          tryGet: vi.fn().mockResolvedValue(null),
          incr: vi.fn().mockImplementation(async () => ++counter),
          eval: evalFn,
        });

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

        // The expiry is attempted on BOTH hits, so a transient first-hit
        // failure cannot leave the key immortal. Whether it actually applies
        // is the script's business, pinned against real Redis in the
        // integration suite; what belongs here is that it is one atomic call
        // over exactly one key, since a second key would need a Cluster hash
        // tag to share a slot.
        expect(evalFn).toHaveBeenCalledTimes(2);
        for (const call of evalFn.mock.calls) {
          expect(call[0]).toContain("TTL");
          expect(call[1]).toBe(1);
          expect(call[2]).toMatch(/^trigger-email-cap:/);
          expect(call[3]).toBe("7200");
          expect(call.length).toBe(4);
        }
      });
    });

    describe("when the SAME dispatch is retried (claim already won)", () => {
      it("re-reads the counter without a second INCR so a retry never burns a cap slot", async () => {
        const incr = vi.fn().mockResolvedValue(1);
        // SET NX: first call wins ("OK"), retry loses (null). The retry must
        // GET the current count instead of INCR-ing it again.
        const set = vi.fn().mockResolvedValueOnce("OK").mockResolvedValueOnce(null);
        redisMock.connection = makeStore({
          trySet: set,
          tryGet: vi.fn().mockResolvedValue("1"),
          incr,
          eval: vi.fn().mockResolvedValue(null),
        });

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
      /** @scenario "Email delivery caps are idempotent across retries" */
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

// The per-project daily cap (ADR-031) — a backstop ABOVE the per-trigger hourly
// cap. Counts RECIPIENTS (actual email volume), not dispatches; the day counter
// advances by recipientCount (INCRBY). Same claim-gate idempotency + in-memory
// fallback as the hourly cap, but degradation logs at WARN not ERROR.
describe("consumeTenantEmailCapSlot in-memory fallback", () => {
  describe("given a fresh day bucket", () => {
    describe("when dispatches accumulate recipients up to the cap then over it", () => {
      it("allows the dispatch that lands at the cap and drops the one that exceeds it", async () => {
        const now = new Date("2026-06-11T10:15:00Z");
        // cap=10, two dispatches of 6 recipients each: first → count 6 (under),
        // second → count 12 (over). Proves the counter advances by recipientCount.
        const first = await consumeTenantEmailCapSlot({
          projectId: PROJECT_ID,
          now,
          cap: 10,
          recipientCount: 6,
          dedupKey: "proj-1:tenant:day-a",
        });
        const second = await consumeTenantEmailCapSlot({
          projectId: PROJECT_ID,
          now,
          cap: 10,
          recipientCount: 6,
          dedupKey: "proj-1:tenant:day-b",
        });

        expect(first).toEqual({ allowed: true, count: 6 });
        expect(second).toEqual({ allowed: false, count: 12 });
      });
    });

    describe("when the SAME dispatch is consumed twice (outbox retry)", () => {
      /** @scenario "Email delivery caps are idempotent across retries" */
      it("does not double-count: the retry re-reads the same total without INCRBY", async () => {
        const now = new Date("2026-06-11T10:15:00Z");
        const args = {
          projectId: PROJECT_ID,
          now,
          cap: 100,
          recipientCount: 4,
          dedupKey: "proj-1:tenant:retry-me",
        };
        const firstCall = await consumeTenantEmailCapSlot(args);
        const retry = await consumeTenantEmailCapSlot(args);
        // A different dispatch advances the counter — proving the retry was
        // suppressed by the claim gate, not by a frozen counter.
        const other = await consumeTenantEmailCapSlot({
          ...args,
          recipientCount: 3,
          dedupKey: "proj-1:tenant:other",
        });

        expect(firstCall).toEqual({ allowed: true, count: 4 });
        expect(retry).toEqual({ allowed: true, count: 4 });
        expect(other).toEqual({ allowed: true, count: 7 });
      });
    });
  });

  describe("given the cap was exhausted in the previous day", () => {
    describe("when a dispatch arrives in the next day bucket", () => {
      it("starts a fresh count and allows it again", async () => {
        const firstDay = new Date("2026-06-11T23:00:00Z");
        await consumeTenantEmailCapSlot({
          projectId: PROJECT_ID,
          now: firstDay,
          cap: 5,
          recipientCount: 5,
          dedupKey: "proj-1:tenant:d1-a",
        });
        const overSameDay = await consumeTenantEmailCapSlot({
          projectId: PROJECT_ID,
          now: firstDay,
          cap: 5,
          recipientCount: 1,
          dedupKey: "proj-1:tenant:d1-b",
        });
        expect(overSameDay.allowed).toBe(false);

        const nextDay = new Date("2026-06-12T01:00:00Z");
        const rolledOver = await consumeTenantEmailCapSlot({
          projectId: PROJECT_ID,
          now: nextDay,
          cap: 5,
          recipientCount: 2,
          dedupKey: "proj-1:tenant:d2-a",
        });

        expect(rolledOver).toEqual({ allowed: true, count: 2 });
      });
    });
  });

  describe("given Redis is connected", () => {
    afterEach(() => {
      redisMock.connection = undefined;
    });

    describe("when a dispatch wins its claim", () => {
      /** @scenario "Email delivery caps are idempotent across retries" */
      it("advances the counter via INCRBY recipientCount, not a plain INCR", async () => {
        const incrby = vi.fn().mockResolvedValue(8);
        redisMock.connection = makeStore({
          trySet: vi.fn().mockResolvedValue("OK"),
          tryGet: vi.fn().mockResolvedValue(null),
          incr: vi.fn(),
          incrby,
          eval: vi.fn().mockResolvedValue(null),
        });

        const now = new Date("2026-06-11T10:15:00Z");
        const result = await consumeTenantEmailCapSlot({
          projectId: PROJECT_ID,
          now,
          cap: 100,
          recipientCount: 8,
          dedupKey: "proj-1:tenant:incrby",
        });

        // INCRBY carried the recipient count; a plain INCR would have ignored it.
        expect(incrby).toHaveBeenCalledTimes(1);
        expect(incrby.mock.calls[0]![0]).toMatch(/^trigger-email-tenant-cap:/);
        expect(incrby.mock.calls[0]![1]).toBe(8);
        expect(result).toEqual({ allowed: true, count: 8 });
      });

      it("keeps INCRBY when the dispatch has one recipient", async () => {
        const incr = vi.fn().mockResolvedValue(1);
        const incrby = vi.fn().mockResolvedValue(1);
        redisMock.connection = makeStore({ incr, incrby });

        await consumeTenantEmailCapSlot({
          projectId: PROJECT_ID,
          now: new Date("2026-06-11T10:15:00Z"),
          cap: 100,
          recipientCount: 1,
          dedupKey: "proj-1:tenant:single-recipient",
        });

        expect(incr).not.toHaveBeenCalled();
        expect(incrby).toHaveBeenCalledWith(expect.stringMatching(/^trigger-email-tenant-cap:/), 1);
      });
    });

    describe("when the SAME dispatch is retried (claim already won)", () => {
      it("re-reads the counter via GET without a second INCRBY", async () => {
        const incrby = vi.fn().mockResolvedValue(4);
        const set = vi.fn().mockResolvedValueOnce("OK").mockResolvedValueOnce(null);
        redisMock.connection = makeStore({
          trySet: set,
          tryGet: vi.fn().mockResolvedValue("4"),
          incr: vi.fn(),
          incrby,
          eval: vi.fn().mockResolvedValue(null),
        });

        const now = new Date("2026-06-11T10:15:00Z");
        const args = {
          projectId: PROJECT_ID,
          now,
          cap: 100,
          recipientCount: 4,
          dedupKey: "proj-1:tenant:redis-retry",
        };
        const firstCall = await consumeTenantEmailCapSlot(args);
        const retry = await consumeTenantEmailCapSlot(args);

        expect(incrby).toHaveBeenCalledTimes(1);
        expect(firstCall).toEqual({ allowed: true, count: 4 });
        expect(retry).toEqual({ allowed: true, count: 4 });
      });
    });
  });

  describe("given Redis fails on every call (sustained outage)", () => {
    afterEach(() => {
      redisMock.connection = undefined;
    });

    describe("when distinct dispatches arrive through the outage", () => {
      it("accumulates in the in-memory counter and logs the degradation at WARN", async () => {
        loggerMock.warn.mockClear();
        loggerMock.error.mockClear();
        redisMock.connection = makeStore({
          trySet: vi.fn().mockRejectedValue(new Error("connection refused")),
          tryGet: vi.fn().mockRejectedValue(new Error("connection refused")),
          incr: vi.fn(),
          incrby: vi.fn().mockRejectedValue(new Error("connection refused")),
          eval: vi.fn().mockRejectedValue(new Error("connection refused")),
        });

        const now = new Date("2026-06-11T10:15:00Z");
        const first = await consumeTenantEmailCapSlot({
          projectId: PROJECT_ID,
          now,
          cap: 10,
          recipientCount: 6,
          dedupKey: "proj-1:tenant:outage-a",
        });
        const second = await consumeTenantEmailCapSlot({
          projectId: PROJECT_ID,
          now,
          cap: 10,
          recipientCount: 6,
          dedupKey: "proj-1:tenant:outage-b",
        });

        // The per-worker counter kept climbing through the outage and tipped
        // over the cap on the second dispatch.
        expect(first).toEqual({ allowed: true, count: 6 });
        expect(second).toEqual({ allowed: false, count: 12 });
        // Backstop degradation surfaces at WARN, not ERROR (the hourly cap is
        // the primary throttle and owns the ERROR-level degraded log).
        expect(loggerMock.warn).toHaveBeenCalled();
        expect(loggerMock.error).not.toHaveBeenCalled();
      });
    });
  });

  describe("given two distinct projects", () => {
    describe("when each dispatches on the same day", () => {
      it("counts them independently", async () => {
        const now = new Date("2026-06-11T10:15:00Z");
        const a = await consumeTenantEmailCapSlot({
          projectId: "proj-a",
          now,
          cap: 5,
          recipientCount: 5,
          dedupKey: "proj-a:tenant:x",
        });
        const b = await consumeTenantEmailCapSlot({
          projectId: "proj-b",
          now,
          cap: 5,
          recipientCount: 5,
          dedupKey: "proj-b:tenant:x",
        });

        expect(a).toEqual({ allowed: true, count: 5 });
        expect(b).toEqual({ allowed: true, count: 5 });
      });
    });
  });
});
