import { describe, expect, it, vi } from "vitest";
import { WorkerMain, type WorkerMainProcessPort } from "../worker.main";
import type {
  WorkerShutdownSignal,
  WorkerSignalSource,
} from "../platform/lifecycle/worker.signals";

class Signals implements WorkerSignalSource {
  private readonly listeners = new Map<WorkerShutdownSignal, Set<() => void>>();

  on(signal: WorkerShutdownSignal, listener: () => void): void {
    const listeners = this.listeners.get(signal) ?? new Set<() => void>();
    listeners.add(listener);
    this.listeners.set(signal, listeners);
  }

  off(signal: WorkerShutdownSignal, listener: () => void): void {
    this.listeners.get(signal)?.delete(listener);
  }

  emit(signal: WorkerShutdownSignal): void {
    for (const listener of this.listeners.get(signal) ?? []) listener();
  }

  listenerCount(signal: WorkerShutdownSignal): number {
    return this.listeners.get(signal)?.size ?? 0;
  }
}

class WorkerStub implements WorkerMainProcessPort {
  readonly logger = { info: vi.fn(), error: vi.fn() };
  readonly start = vi.fn<() => Promise<void>>(async () => void 0);
  readonly close = vi.fn<() => Promise<void>>(async () => void 0);
}

function createMain(worker = new WorkerStub()) {
  const source = new Signals();
  const exits: number[] = [];
  const main = WorkerMain.create({
    worker,
    signals: { source, exit: (code) => exits.push(code) },
  });
  return { exits, main, source, worker };
}

describe("WorkerMain", () => {
  it("closes cleanly and exits zero after a shutdown signal", async () => {
    const { exits, source, worker } = createMain();

    source.emit("SIGTERM");

    await vi.waitFor(() => expect(exits).toEqual([0]));
    expect(worker.close).toHaveBeenCalledOnce();
  });

  it("exits one when a signal-triggered close fails", async () => {
    const failure = new Error("queue drain failed");
    const worker = new WorkerStub();
    worker.close.mockRejectedValueOnce(failure);
    const { exits, source } = createMain(worker);

    source.emit("SIGINT");

    await vi.waitFor(() => expect(exits).toEqual([1]));
    expect(worker.close).toHaveBeenCalledOnce();
  });

  it("coalesces repeated signals into one close and one exit", async () => {
    let release: (() => void) | undefined;
    const worker = new WorkerStub();
    worker.close.mockImplementation(
      async () =>
        await new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const { exits, source } = createMain(worker);

    source.emit("SIGTERM");
    source.emit("SIGINT");

    await vi.waitFor(() => expect(worker.close).toHaveBeenCalledOnce());
    expect(exits).toEqual([]);
    release?.();
    await vi.waitFor(() => expect(exits).toEqual([0]));
  });

  it("disposes signal listeners after a manual close without exiting", async () => {
    const { exits, main, source, worker } = createMain();

    await main.close();

    expect(source.listenerCount("SIGTERM")).toBe(0);
    expect(source.listenerCount("SIGINT")).toBe(0);
    source.emit("SIGTERM");
    expect(worker.close).toHaveBeenCalledOnce();
    expect(exits).toEqual([]);
  });

  it("does not report a failed start as a successful shutdown", async () => {
    const worker = new WorkerStub();
    worker.start.mockRejectedValueOnce(new Error("queue readiness failed"));
    const { exits, main } = createMain(worker);

    await expect(main.start()).rejects.toThrow("queue readiness failed");
    expect(exits).toEqual([]);

    await main.close();
  });
});
