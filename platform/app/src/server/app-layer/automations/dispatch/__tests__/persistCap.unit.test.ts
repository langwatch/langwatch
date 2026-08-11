import { beforeEach, describe, expect, it, vi } from "vitest";

// `connection` is undefined under vitest, so these exercise the in-memory
// fallback. The counting contract is the same either way; what differs is the
// blast radius when Redis is down, which the email caps already pin.
vi.mock("~/server/redis", () => ({ connection: undefined }));

const planMock = vi.hoisted(() => ({
  getActivePlan: vi.fn(),
  resolveOrganizationId: vi.fn(),
}));
vi.mock("~/server/app-layer/app", () => ({
  getApp: () => ({ planProvider: { getActivePlan: planMock.getActivePlan } }),
}));
vi.mock("~/server/organizations/resolveOrganizationId", () => ({
  resolveOrganizationId: planMock.resolveOrganizationId,
}));

// The TTL cache would otherwise carry one test's plan answer into the next.
const cacheMock = vi.hoisted(() => ({ store: new Map<string, unknown>() }));
vi.mock("~/server/utils/ttlCache", () => ({
  TtlCache: class {
    constructor(
      private readonly _ttl: number,
      private readonly prefix: string,
    ) {}
    async get(key: string) {
      return cacheMock.store.get(`${this.prefix}${key}`);
    }
    async set(key: string, value: unknown) {
      cacheMock.store.set(`${this.prefix}${key}`, value);
    }
  },
}));

import { env } from "~/env.mjs";
import {
  _resetMemoryPersistCapStore,
  consumePersistCapSlot,
  persistCapClaimKey,
  persistCapKey,
  readPersistCapCounts,
  resolvePersistDailyCap,
} from "../persistCap";

const PROJECT_ID = "proj-1";
const TRIGGER_ID = "trig-1";
const DAY_ONE = new Date("2026-08-09T12:00:00.000Z");
const DAY_TWO = new Date("2026-08-10T00:00:01.000Z");

function plan(overrides: Record<string, unknown>) {
  planMock.resolveOrganizationId.mockResolvedValue("org-1");
  planMock.getActivePlan.mockResolvedValue({
    planSource: "subscription",
    name: "Plan",
    free: false,
    maxMembers: 1,
    maxMembersLite: 1,
    maxMessagesPerMonth: 1,
    canPublish: true,
    prices: { USD: 0, EUR: 0 },
    ...overrides,
  });
}

describe("given the two keys one Lua script touches together", () => {
  describe("when their Redis Cluster slots are compared", () => {
    /** @scenario "The ceiling survives a clustered Redis" */
    it("routes both to one slot by sharing a hash tag", () => {
      const hashTag = (key: string) => key.match(/\{([^}]*)\}/)?.[1];
      const dedupKey = `${PROJECT_ID}/${TRIGGER_ID}:persist:trace-1`;
      const counter = persistCapKey({
        projectId: PROJECT_ID,
        triggerId: TRIGGER_ID,
        now: new Date("2026-08-09T12:00:00.000Z"),
      });
      const claim = persistCapClaimKey({
        projectId: PROJECT_ID,
        triggerId: TRIGGER_ID,
        dedupKey,
      });

      // Cluster hashes only what is between the braces. Without a shared tag
      // the EVAL is rejected with CROSSSLOT, which this module catches as an
      // ordinary Redis error and answers by dropping to per-worker counters,
      // so the fleet-wide ceiling silently stops being fleet-wide.
      expect(hashTag(counter)).toBe(`${PROJECT_ID}:${TRIGGER_ID}`);
      expect(hashTag(claim)).toBe(hashTag(counter));
    });
  });
});

describe("given a project on a plan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cacheMock.store.clear();
    _resetMemoryPersistCapStore();
  });

  describe("when its daily ceiling is resolved", () => {
    /** @scenario "A free plan gets the smallest daily ceiling" */
    it("gives a free plan the free-tier ceiling", async () => {
      plan({ type: "FREE", free: true });

      expect(await resolvePersistDailyCap(PROJECT_ID)).toBe(
        env.TRIGGER_PERSIST_DAILY_CAP_FREE,
      );
    });

    it("gives the entry paid tier the free-tier ceiling too", async () => {
      // LAUNCH is a paid plan, but its automation volume is the same shape as a
      // free account's, so it shares the smaller allowance by design.
      plan({ type: "LAUNCH" });

      expect(await resolvePersistDailyCap(PROJECT_ID)).toBe(
        env.TRIGGER_PERSIST_DAILY_CAP_FREE,
      );
    });

    /** @scenario "A paid plan gets the standard daily ceiling" */
    it("gives a paid non-enterprise plan the paid ceiling", async () => {
      plan({ type: "ACCELERATE" });

      expect(await resolvePersistDailyCap(PROJECT_ID)).toBe(
        env.TRIGGER_PERSIST_DAILY_CAP_PAID,
      );
    });

    /** @scenario "An enterprise plan gets the largest daily ceiling" */
    it("gives an enterprise plan the enterprise ceiling", async () => {
      plan({ type: "ENTERPRISE" });

      expect(await resolvePersistDailyCap(PROJECT_ID)).toBe(
        env.TRIGGER_PERSIST_DAILY_CAP_ENTERPRISE,
      );
    });

    /** @scenario "A contract can raise a single customer's ceiling" */
    it("lets a contract allowance win over the plan tier default", async () => {
      plan({
        type: "FREE",
        free: true,
        maxTriggerPersistDispatchesPerDay: 50_000,
      });

      expect(await resolvePersistDailyCap(PROJECT_ID)).toBe(50_000);
    });
  });

  describe("when the plan cannot be resolved", () => {
    it("falls back to the paid ceiling rather than throttling to nothing", async () => {
      // The fallback is open against the free tier, which is the common case.
      planMock.resolveOrganizationId.mockRejectedValue(new Error("no org"));

      expect(await resolvePersistDailyCap(PROJECT_ID)).toBe(
        env.TRIGGER_PERSIST_DAILY_CAP_PAID,
      );
    });

    /** @scenario "A ceiling that could not be resolved is not remembered" */
    it("does not cache the fallback, so the next dispatch resolves the real ceiling", async () => {
      // The same fallback is CLOSED against the enterprise tier, at a tenth of
      // its allowance, and over-ceiling matches are dropped terminally. Caching
      // it would turn one failed read into ten minutes of an enterprise account
      // silently losing nine tenths of its automation output.
      planMock.resolveOrganizationId.mockRejectedValueOnce(new Error("blip"));
      expect(await resolvePersistDailyCap(PROJECT_ID)).toBe(
        env.TRIGGER_PERSIST_DAILY_CAP_PAID,
      );

      plan({ type: "ENTERPRISE" });

      expect(await resolvePersistDailyCap(PROJECT_ID)).toBe(
        env.TRIGGER_PERSIST_DAILY_CAP_ENTERPRISE,
      );
    });
  });
});

describe("given a trigger with a daily ceiling", () => {
  beforeEach(() => {
    _resetMemoryPersistCapStore();
  });

  const consume = (traceId: string, now = DAY_ONE, cap = 2) =>
    consumePersistCapSlot({
      projectId: PROJECT_ID,
      triggerId: TRIGGER_ID,
      now,
      cap,
      dedupKey: `${PROJECT_ID}/${TRIGGER_ID}:persist:${traceId}`,
    });

  describe("when confirmed dispatches consume slots", () => {
    it("allows dispatches up to the ceiling", async () => {
      expect(await consume("trace-1")).toMatchObject({
        allowed: true,
        count: 1,
      });
      expect(await consume("trace-2")).toMatchObject({
        allowed: true,
        count: 2,
      });
    });

    it("refuses the dispatch that would pass the ceiling", async () => {
      await consume("trace-1");
      await consume("trace-2");

      expect(await consume("trace-3")).toMatchObject({
        allowed: false,
        count: 3,
      });
    });

    /** @scenario "An outbox retry of the same dispatch does not consume a second slot" */
    it("re-reads the count when the same dispatch is presented again", async () => {
      await consume("trace-1");

      const retry = await consume("trace-1");

      expect(retry.count).toBe(1);
      expect(retry.allowed).toBe(true);
    });

    /** @scenario "Skipped matches are counted so the customer can see them" */
    it("keeps counting past the ceiling so the overshoot is measurable", async () => {
      // Stopping at the cap would make a trigger that overshot by one look
      // identical to one that overshot by fifty thousand, and the customer-facing
      // "N matches skipped today" is exactly that difference.
      for (const traceId of ["t1", "t2", "t3", "t4", "t5"]) {
        await consume(traceId);
      }

      const last = await consume("t6");
      expect(last.count).toBe(6);
      expect(last.skipped).toBe(4);
    });

    /** @scenario "The ceiling resets at the start of the next UTC day" */
    it("starts a fresh count on the next UTC day", async () => {
      await consume("trace-1");
      await consume("trace-2");
      expect(await consume("trace-3")).toMatchObject({ allowed: false });

      const tomorrow = await consume("trace-4", DAY_TWO);

      expect(tomorrow).toMatchObject({ allowed: true, count: 1, skipped: 0 });
    });
  });
});

describe("given a project whose triggers have consumed slots today", () => {
  beforeEach(() => {
    _resetMemoryPersistCapStore();
  });

  describe("when the automations list reads their counts", () => {
    it("reports today's skipped count per trigger without consuming a slot", async () => {
      for (const traceId of ["t1", "t2", "t3"]) {
        await consumePersistCapSlot({
          projectId: PROJECT_ID,
          triggerId: TRIGGER_ID,
          now: DAY_ONE,
          cap: 2,
          dedupKey: `${PROJECT_ID}/${TRIGGER_ID}:persist:${traceId}`,
        });
      }

      const counts = await readPersistCapCounts({
        projectId: PROJECT_ID,
        triggerIds: [TRIGGER_ID, "trig-quiet"],
        now: DAY_ONE,
        cap: 2,
      });

      expect(counts[TRIGGER_ID]).toEqual({ count: 3, skipped: 1 });
      expect(counts["trig-quiet"]).toEqual({ count: 0, skipped: 0 });
    });
  });
});
