import { describe, expect, it, vi } from "vitest";
import {
  WorkerSignalHandlers,
  type WorkerShutdownSignal,
  type WorkerSignalSource,
} from "../worker.signals";

class Signals implements WorkerSignalSource {
  private readonly handlers = new Map<WorkerShutdownSignal, Set<() => void>>();

  on(signal: WorkerShutdownSignal, listener: () => void): void {
    const listeners = this.handlers.get(signal) ?? new Set<() => void>();
    listeners.add(listener);
    this.handlers.set(signal, listeners);
  }

  off(signal: WorkerShutdownSignal, listener: () => void): void {
    this.handlers.get(signal)?.delete(listener);
  }

  emit(signal: WorkerShutdownSignal): void {
    for (const listener of this.handlers.get(signal) ?? []) listener();
  }

  listenerCount(signal: WorkerShutdownSignal): number {
    return this.handlers.get(signal)?.size ?? 0;
  }
}

describe("WorkerSignalHandlers", () => {
  it("coalesces repeated signals, drains once, and removes listeners", async () => {
    const source = new Signals();
    const close = vi.fn(async () => undefined);
    const logger = { info: vi.fn(), error: vi.fn() };
    const onComplete = vi.fn();
    WorkerSignalHandlers.install({ source, close, logger, onComplete, onFailure: vi.fn() });

    source.emit("SIGTERM");
    source.emit("SIGINT");
    await Promise.resolve();
    await Promise.resolve();

    expect(close).toHaveBeenCalledOnce();
    expect(source.listenerCount("SIGTERM")).toBe(0);
    expect(source.listenerCount("SIGINT")).toBe(0);
    expect(logger.info).toHaveBeenCalledWith({ signal: "SIGTERM" }, "worker shutdown requested");
    expect(onComplete).toHaveBeenCalledWith("SIGTERM");
  });

  it("logs close failures without creating an unhandled signal rejection", async () => {
    const source = new Signals();
    const failure = new Error("drain failed");
    const close = vi.fn(async () => {
      throw failure;
    });
    const logger = { info: vi.fn(), error: vi.fn() };
    const onFailure = vi.fn();
    WorkerSignalHandlers.install({ source, close, logger, onFailure });

    source.emit("SIGINT");
    await Promise.resolve();
    await Promise.resolve();

    expect(logger.error).toHaveBeenCalledWith(
      { error: failure, signal: "SIGINT" },
      "worker shutdown failed",
    );
    expect(onFailure).toHaveBeenCalledWith(failure, "SIGINT");
  });

  it("reports a failure from the executable policy instead of dropping it", async () => {
    const source = new Signals();
    const close = vi.fn(async () => {
      throw new Error("drain failed");
    });
    const logger = { info: vi.fn(), error: vi.fn() };
    const policyFailure = new Error("exit policy failed");
    WorkerSignalHandlers.install({
      source,
      close,
      logger,
      onFailure: () => {
        throw policyFailure;
      },
    });

    source.emit("SIGTERM");
    await Promise.resolve();
    await Promise.resolve();

    expect(logger.error).toHaveBeenCalledWith(
      { error: policyFailure, signal: "SIGTERM" },
      "worker shutdown failure policy failed",
    );
  });

  it("enforces an executable-owned shutdown deadline while a drain is still pending", async () => {
    vi.useFakeTimers();
    try {
      const source = new Signals();
      let release: (() => void) | undefined;
      const close = vi.fn(
        async () =>
          await new Promise<void>((resolve) => {
            release = resolve;
          }),
      );
      const logger = { info: vi.fn(), error: vi.fn() };
      const onDeadline = vi.fn();
      WorkerSignalHandlers.install({
        source,
        close,
        logger,
        deadlineMs: 10,
        onDeadline,
        onFailure: vi.fn(),
      });

      source.emit("SIGTERM");
      await vi.advanceTimersByTimeAsync(10);

      expect(logger.error).toHaveBeenCalledWith(
        { signal: "SIGTERM", deadlineMs: 10 },
        "worker shutdown exceeded its deadline",
      );
      expect(onDeadline).toHaveBeenCalledWith("SIGTERM");
      release?.();
      await vi.runAllTimersAsync();
    } finally {
      vi.useRealTimers();
    }
  });
});
