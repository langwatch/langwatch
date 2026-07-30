/**
 * The scheduled Langy session-key reap, driven off its `reap`/`recordTick`
 * ports — never off an event, since the pipeline carries none.
 *
 * @see specs/langy/langy-session-key-reap-sweep.feature
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockLogger } = vi.hoisted(() => ({
  mockLogger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn(),
  },
}));

vi.mock("@langwatch/observability", () => ({
  createLogger: () => mockLogger,
}));

import {
  createLangySessionKeyReapMount,
  LANGY_SESSION_KEY_REAP_NAME,
  type LangySessionKeyReapDeps,
} from "..";

type MockedDeps = {
  [K in keyof LangySessionKeyReapDeps]: ReturnType<typeof vi.fn>;
} & LangySessionKeyReapDeps;

function makeDeps(
  overrides: Partial<LangySessionKeyReapDeps> = {},
): MockedDeps {
  return {
    reap: vi.fn().mockResolvedValue(0),
    recordTick: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as MockedDeps;
}

function makeMetrics() {
  const counters = new Map<string, { inc: ReturnType<typeof vi.fn> }>();
  return {
    metrics: {
      counter: vi.fn(({ name }: { name: string }) => {
        const existing = counters.get(name);
        if (existing) return existing;
        const created = { inc: vi.fn() };
        counters.set(name, created);
        return created;
      }),
      histogram: vi.fn().mockReturnValue({ observe: vi.fn() }),
    },
    counterFor: (name: string) => counters.get(name),
  };
}

describe("the langy session-key reap tick", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("given the reap's fixed interval wakes it, with elapsed keys to revoke", () => {
    /** @scenario "The scheduled reap revokes every elapsed session key" */
    it("reaps and records the tick once", async () => {
      const deps = makeDeps({ reap: vi.fn().mockResolvedValue(3) });

      await createLangySessionKeyReapMount(deps).run();

      expect(deps.reap).toHaveBeenCalledOnce();
      expect(deps.recordTick).toHaveBeenCalledOnce();
    });

    it("does not log a second success line of its own — reap owns that report", async () => {
      const deps = makeDeps({ reap: vi.fn().mockResolvedValue(3) });

      await createLangySessionKeyReapMount(deps).run();

      expect(mockLogger.info).not.toHaveBeenCalled();
    });

    it("counts the keys as items and the tick as one tick, on separate metrics", async () => {
      const { metrics, counterFor } = makeMetrics();
      const deps = makeDeps({ reap: vi.fn().mockResolvedValue(3) });

      await createLangySessionKeyReapMount({ ...deps, metrics }).run();

      // A ratio off a counter that mixes ticks and revoked keys means nothing,
      // so the two units never share a series.
      expect(
        counterFor("es_langy_session_key_reap_items_total")?.inc,
      ).toHaveBeenCalledWith({ outcome: "success" }, 3);
      expect(
        counterFor("es_langy_session_key_reap_ticks_total")?.inc,
      ).toHaveBeenCalledWith({ outcome: "success" });
      expect(
        counterFor("es_langy_session_key_reap_ticks_total")?.inc,
      ).toHaveBeenCalledTimes(1);
    });
  });

  describe("given the reap fails", () => {
    /** @scenario "A failed reap is counted as one failed candidate" */
    it("counts one failed tick, and no items it never got to look at", async () => {
      const { metrics, counterFor } = makeMetrics();
      const deps = makeDeps({
        reap: vi.fn().mockRejectedValue(new Error("database unavailable")),
      });

      await expect(
        createLangySessionKeyReapMount({ ...deps, metrics }).run(),
      ).rejects.toThrow();

      expect(
        counterFor("es_langy_session_key_reap_ticks_total")?.inc,
      ).toHaveBeenCalledWith({ outcome: "failure" });
      expect(
        counterFor("es_langy_session_key_reap_items_total")?.inc,
      ).not.toHaveBeenCalled();
    });

    /** @scenario "A failed reap is retried" */
    it("raises so the whole tick is retried", async () => {
      const deps = makeDeps({
        reap: vi.fn().mockRejectedValue(new Error("database unavailable")),
      });

      await expect(createLangySessionKeyReapMount(deps).run()).rejects.toThrow(
        "database unavailable",
      );

      // Retrying is free — a key already revoked stays revoked — so the whole
      // tick, not a partial replay, is what gets retried.
      expect(deps.recordTick).toHaveBeenCalledOnce();
    });
  });

  describe("given the reap succeeds, and recording the tick fails", () => {
    /** @scenario "A bookkeeping failure does not fail a successful reap" */
    it("does not report the reap itself as failed", async () => {
      const deps = makeDeps({
        reap: vi.fn().mockResolvedValue(2),
        recordTick: vi
          .fn()
          .mockRejectedValue(new Error("bookkeeping store unavailable")),
      });

      await expect(
        createLangySessionKeyReapMount(deps).run(),
      ).resolves.toBeUndefined();
    });
  });

  describe("given the reap fails, and recording the tick also fails", () => {
    /** @scenario "Tick bookkeeping still runs after the reap fails" */
    it("still raises the reap's own failure, not the bookkeeping one", async () => {
      const deps = makeDeps({
        reap: vi.fn().mockRejectedValue(new Error("database unavailable")),
        recordTick: vi
          .fn()
          .mockRejectedValue(new Error("bookkeeping store unavailable")),
      });

      await expect(createLangySessionKeyReapMount(deps).run()).rejects.toThrow(
        "database unavailable",
      );
      expect(deps.recordTick).toHaveBeenCalledOnce();
    });
  });

  describe("createLangySessionKeyReapMount", () => {
    /** @scenario "The mount carries the hourly interval and runs the same reap logic" */
    it("names itself, carries the interval, and runs the same reap through run()", async () => {
      const deps = makeDeps({ reap: vi.fn().mockResolvedValue(1) });
      const mount = createLangySessionKeyReapMount(deps);

      expect(mount.name).toBe(LANGY_SESSION_KEY_REAP_NAME);
      expect(mount.intervalMs).toBe(60 * 60 * 1000);

      await mount.run();

      expect(deps.reap).toHaveBeenCalledOnce();
    });
  });
});
