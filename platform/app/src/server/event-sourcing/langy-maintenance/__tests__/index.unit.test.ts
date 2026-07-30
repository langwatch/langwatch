/**
 * Unit tests for the scheduled Langy session-key reap — driven directly off
 * `runLangySessionKeyReap`'s `reap`/`recordTick` ports, never off an event,
 * since the pipeline carries none.
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
  runLangySessionKeyReap,
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
    now: vi.fn().mockReturnValue(10_000_000),
    ...overrides,
  } as MockedDeps;
}

function makeMetrics() {
  const inc = vi.fn();
  return {
    metrics: {
      counter: vi.fn().mockReturnValue({ inc }),
      histogram: vi.fn().mockReturnValue({ observe: vi.fn() }),
    },
    inc,
  };
}

describe("runLangySessionKeyReap", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("given the reap's fixed interval wakes it, with elapsed keys to revoke", () => {
    /** @scenario "The scheduled reap revokes every elapsed session key" */
    it("reaps and records the tick once", async () => {
      const deps = makeDeps({ reap: vi.fn().mockResolvedValue(3) });

      await runLangySessionKeyReap(deps)();

      expect(deps.reap).toHaveBeenCalledOnce();
      expect(deps.recordTick).toHaveBeenCalledOnce();
    });

    it("does not log a second success line of its own — reap owns that report", async () => {
      const deps = makeDeps({ reap: vi.fn().mockResolvedValue(3) });

      await runLangySessionKeyReap(deps)();

      expect(mockLogger.info).not.toHaveBeenCalled();
    });
  });

  describe("given the reap fails", () => {
    /** @scenario "A failed reap is counted as one failed candidate" */
    it("counts the failure on the same metric successes are counted on", async () => {
      const { metrics, inc } = makeMetrics();
      const deps = makeDeps({
        reap: vi.fn().mockRejectedValue(new Error("database unavailable")),
      });

      await expect(
        runLangySessionKeyReap({ ...deps, metrics })(),
      ).rejects.toThrow();

      expect(metrics.counter).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "es_langy_session_key_reap_candidates_total",
        }),
      );
      expect(inc).toHaveBeenCalledWith({ outcome: "failure" });
    });

    /** @scenario "A failed reap is retried" */
    it("raises so the whole tick is retried", async () => {
      const deps = makeDeps({
        reap: vi.fn().mockRejectedValue(new Error("database unavailable")),
      });

      await expect(runLangySessionKeyReap(deps)()).rejects.toThrow(
        "database unavailable",
      );

      // Retrying is free — a key already revoked stays revoked — so the
      // whole tick, not a partial replay, is what gets retried.
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

      await expect(runLangySessionKeyReap(deps)()).resolves.toBeUndefined();
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

      await expect(runLangySessionKeyReap(deps)()).rejects.toThrow(
        "database unavailable",
      );
      expect(deps.recordTick).toHaveBeenCalledOnce();
    });
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
