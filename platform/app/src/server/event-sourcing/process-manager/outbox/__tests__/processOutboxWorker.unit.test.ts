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
    const runOnce = vi
      .fn()
      .mockRejectedValueOnce(new Error("database unavailable"))
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
    expect(logger.error).toHaveBeenCalledOnce();
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
});
