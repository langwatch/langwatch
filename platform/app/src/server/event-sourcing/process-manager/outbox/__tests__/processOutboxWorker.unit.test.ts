import type { Logger } from "@langwatch/observability";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ProcessOutboxWorker } from "../processOutboxWorker";

function makeLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as Logger;
}

function report() {
  return { dispatched: [], retried: [], dead: [], released: [], fenced: [] };
}

/** A drain that leased and dispatched one message: never idle. */
function busyReport() {
  return { ...report(), dispatched: ["message-1"] };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("ProcessOutboxWorker", () => {
  it("drains immediately when composition starts it", async () => {
    const runOnce = vi.fn().mockResolvedValue(report());
    const worker = new ProcessOutboxWorker({
      dispatcher: { runOnce },
      logger: makeLogger(),
      batchSize: 25,
      now: () => 123,
    });

    worker.start();
    await vi.waitFor(() => expect(runOnce).toHaveBeenCalledTimes(1));

    expect(runOnce).toHaveBeenCalledWith({ now: 123, limit: 25 });
    await worker.stop();
  });

  it("logs a failed drain and recovers on the next poll", async () => {
    vi.useFakeTimers();
    const logger = makeLogger();
    const failure = new Error("database unavailable");
    const runOnce = vi
      .fn()
      .mockRejectedValueOnce(failure)
      .mockResolvedValue(report());
    const worker = new ProcessOutboxWorker({
      dispatcher: { runOnce },
      logger,
      intervalMs: 100,
    });

    worker.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(runOnce).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(100);

    expect(runOnce).toHaveBeenCalledTimes(2);
    // Warning, not error: the drain is retried on the next poll, and the very
    // next assertion is that it recovered.
    expect(logger.warn).toHaveBeenCalledOnce();
    expect(logger.error).not.toHaveBeenCalled();
    // The Error itself, not its message: a bare string under `error` loses the
    // stack and the log collector drops the field outright (saas#1041).
    expect(vi.mocked(logger.warn).mock.calls[0]?.[0]).toMatchObject({
      error: failure,
    });
    await worker.stop();
  });

  it("never overlaps drains when polling is faster than dispatch", async () => {
    vi.useFakeTimers();
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const runOnce = vi
      .fn()
      .mockImplementationOnce(async () => blocked)
      .mockResolvedValue(report());
    const worker = new ProcessOutboxWorker({
      dispatcher: { runOnce },
      logger: makeLogger(),
      intervalMs: 100,
    });

    worker.start();
    await vi.advanceTimersByTimeAsync(500);
    expect(runOnce).toHaveBeenCalledTimes(1);

    release();
    await blocked;
    await vi.advanceTimersByTimeAsync(0);
    expect(runOnce).toHaveBeenCalledTimes(2);
    await worker.stop();
  });

  it("drains again immediately when notified during an active drain", async () => {
    vi.useFakeTimers();
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const runOnce = vi
      .fn()
      .mockImplementationOnce(async () => blocked)
      .mockResolvedValue(report());
    const worker = new ProcessOutboxWorker({
      dispatcher: { runOnce },
      logger: makeLogger(),
      // Prove notify, rather than the recovery poll, causes the second drain.
      intervalMs: 60_000,
    });

    worker.start();
    expect(runOnce).toHaveBeenCalledTimes(1);
    worker.notify();
    expect(runOnce).toHaveBeenCalledTimes(1);

    release();
    await blocked;
    await vi.advanceTimersByTimeAsync(0);

    expect(runOnce).toHaveBeenCalledTimes(2);
    await worker.stop();
  });

  /** @scenario A never-settling delivery cannot wedge a worker's drain loop */
  it("abandons a drain that never settles and resumes polling", async () => {
    vi.useFakeTimers();
    const logger = makeLogger();
    const never = new Promise<void>(() => undefined);
    const runOnce = vi
      .fn()
      .mockImplementationOnce(async () => never)
      .mockResolvedValue(report());
    const worker = new ProcessOutboxWorker({
      dispatcher: { runOnce },
      logger,
      name: "pilot",
      intervalMs: 100,
      stuckDrainTimeoutMs: 1_000,
    });

    worker.start();
    expect(runOnce).toHaveBeenCalledTimes(1);

    // While the drain hangs, polls only set drainRequested.
    await vi.advanceTimersByTimeAsync(900);
    expect(runOnce).toHaveBeenCalledTimes(1);

    // Past the threshold the watchdog abandons the stuck drain and the next
    // poll (or the pending notification) drains again.
    await vi.advanceTimersByTimeAsync(200);
    expect(runOnce.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(logger.error).toHaveBeenCalledOnce();
    await worker.stop();
  });

  it("stops starting drains once too many abandoned ones are still pending", async () => {
    vi.useFakeTimers();
    const logger = makeLogger();
    const never = new Promise<void>(() => undefined);
    const runOnce = vi.fn().mockImplementation(async () => never);
    const worker = new ProcessOutboxWorker({
      dispatcher: { runOnce },
      logger,
      name: "pilot",
      intervalMs: 100,
      stuckDrainTimeoutMs: 1_000,
    });

    worker.start();
    // One drain abandoned per threshold, each replaced by the next poll,
    // until five are retained and the worker refuses to retain a sixth.
    await vi.advanceTimersByTimeAsync(10_000);

    expect(runOnce).toHaveBeenCalledTimes(5);
    const refusals = vi
      .mocked(logger.error)
      .mock.calls.filter(([, message]) =>
        String(message).includes("refusing to start another"),
      );
    // Said once, not once per poll: the refusal must not flood the logs.
    expect(refusals).toHaveLength(1);
    await worker.stop();
  });

  it("resumes draining when an abandoned drain finally settles", async () => {
    vi.useFakeTimers();
    const releases: Array<() => void> = [];
    const runOnce = vi.fn().mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          releases.push(resolve);
        }),
    );
    const worker = new ProcessOutboxWorker({
      dispatcher: { runOnce },
      logger: makeLogger(),
      name: "pilot",
      intervalMs: 100,
      stuckDrainTimeoutMs: 1_000,
    });

    worker.start();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(runOnce).toHaveBeenCalledTimes(5);

    // The first hung delivery settles after all, so its slot comes back and
    // polling recovers without a restart.
    releases[0]?.();
    await vi.advanceTimersByTimeAsync(100);

    expect(runOnce).toHaveBeenCalledTimes(6);

    for (const release of releases) release();
    await vi.advanceTimersByTimeAsync(0);
    await worker.stop();
  });

  it("does not abandon a drain that is merely slow but under the threshold", async () => {
    vi.useFakeTimers();
    const logger = makeLogger();
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const runOnce = vi
      .fn()
      .mockImplementationOnce(async () => blocked)
      .mockResolvedValue(report());
    const worker = new ProcessOutboxWorker({
      dispatcher: { runOnce },
      logger,
      name: "pilot",
      intervalMs: 100,
      stuckDrainTimeoutMs: 10_000,
    });

    worker.start();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(runOnce).toHaveBeenCalledTimes(1);
    expect(logger.error).not.toHaveBeenCalled();

    release();
    await blocked;
    await vi.advanceTimersByTimeAsync(0);
    expect(runOnce).toHaveBeenCalledTimes(2);
    await worker.stop();
  });

  describe("given drains that lease nothing", () => {
    /** @scenario "An idle outbox worker backs off its recovery poll until notified" */
    it("doubles the interval after each empty poll, up to the ceiling", async () => {
      vi.useFakeTimers();
      const runOnce = vi.fn().mockResolvedValue(report());
      const worker = new ProcessOutboxWorker({
        dispatcher: { runOnce },
        logger: makeLogger(),
        intervalMs: 1_000,
        maxIdleIntervalMs: 4_000,
      });

      worker.start();
      await vi.advanceTimersByTimeAsync(0);
      const pollTimes: number[] = [];
      for (let elapsed = 0; elapsed < 20_000; elapsed += 250) {
        const before = runOnce.mock.calls.length;
        await vi.advanceTimersByTimeAsync(250);
        if (runOnce.mock.calls.length > before) pollTimes.push(elapsed + 250);
      }

      // Each poll is armed when it fires, so the doubling lands one poll late.
      expect(pollTimes).toEqual([1_000, 3_000, 7_000, 11_000, 15_000, 19_000]);
      await worker.stop();
    });

    /** @scenario "An idle outbox worker backs off its recovery poll until notified" */
    it("drains at once on notify and polls at the base interval again", async () => {
      vi.useFakeTimers();
      const runOnce = vi.fn().mockResolvedValue(report());
      const worker = new ProcessOutboxWorker({
        dispatcher: { runOnce },
        logger: makeLogger(),
        intervalMs: 1_000,
      });

      worker.start();
      await vi.advanceTimersByTimeAsync(20_000);
      const backedOff = runOnce.mock.calls.length;

      runOnce.mockResolvedValueOnce(busyReport());
      worker.notify();
      await vi.advanceTimersByTimeAsync(0);
      expect(runOnce).toHaveBeenCalledTimes(backedOff + 1);

      await vi.advanceTimersByTimeAsync(1_000);
      expect(runOnce).toHaveBeenCalledTimes(backedOff + 2);
      await worker.stop();
    });

    /** @scenario "An idle outbox worker backs off its recovery poll until notified" */
    it("returns to the base interval once a poll leases a message", async () => {
      vi.useFakeTimers();
      const runOnce = vi.fn().mockResolvedValue(report());
      const worker = new ProcessOutboxWorker({
        dispatcher: { runOnce },
        logger: makeLogger(),
        intervalMs: 1_000,
        maxIdleIntervalMs: 8_000,
      });

      worker.start();
      // Polls at 1s, 3s, 7s; the next is armed 8s out, for 15s.
      await vi.advanceTimersByTimeAsync(7_000);
      expect(runOnce).toHaveBeenCalledTimes(4);

      runOnce.mockResolvedValueOnce(busyReport());
      await vi.advanceTimersByTimeAsync(8_000);
      expect(runOnce).toHaveBeenCalledTimes(5);

      await vi.advanceTimersByTimeAsync(1_000);
      expect(runOnce).toHaveBeenCalledTimes(6);
      await worker.stop();
    });

    it("keeps polling at the base interval while drains fail", async () => {
      vi.useFakeTimers();
      const runOnce = vi
        .fn()
        .mockRejectedValue(new Error("database unavailable"));
      const worker = new ProcessOutboxWorker({
        dispatcher: { runOnce },
        logger: makeLogger(),
        intervalMs: 1_000,
      });

      worker.start();
      await vi.advanceTimersByTimeAsync(5_000);

      expect(runOnce).toHaveBeenCalledTimes(6);
      await worker.stop();
    });

    it("stops polling once stopped, even while backed off", async () => {
      vi.useFakeTimers();
      const runOnce = vi.fn().mockResolvedValue(report());
      const worker = new ProcessOutboxWorker({
        dispatcher: { runOnce },
        logger: makeLogger(),
        intervalMs: 1_000,
      });

      worker.start();
      await vi.advanceTimersByTimeAsync(10_000);
      await worker.stop();
      const stoppedAt = runOnce.mock.calls.length;

      worker.notify();
      await vi.advanceTimersByTimeAsync(120_000);
      expect(runOnce).toHaveBeenCalledTimes(stoppedAt);
    });
  });
});
