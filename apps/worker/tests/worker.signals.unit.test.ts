import { describe, expect, it, vi } from "vitest";
import {
  WorkerSignalHandlers,
  type WorkerShutdownSignal,
  type WorkerSignalSource,
} from "../src/platform/lifecycle/worker.signals";

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
    WorkerSignalHandlers.install({ source, close, logger, onFailure: vi.fn() });

    source.emit("SIGTERM");
    source.emit("SIGINT");
    await Promise.resolve();
    await Promise.resolve();

    expect(close).toHaveBeenCalledOnce();
    expect(source.listenerCount("SIGTERM")).toBe(0);
    expect(source.listenerCount("SIGINT")).toBe(0);
    expect(logger.info).toHaveBeenCalledWith({ signal: "SIGTERM" }, "worker shutdown requested");
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
});
