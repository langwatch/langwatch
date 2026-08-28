import { describe, expect, it, vi } from "vitest";
import { ResourceScope } from "@langwatch/runtime-composition";
import {
  WorkerHandlePort,
  WorkerLifecyclePort,
  WorkerTransportPort,
} from "../src/platform/lifecycle/worker-runtime.port";
import { WorkerRuntime } from "../src/platform/lifecycle/worker.runtime";

class TestWorkerHandle extends WorkerHandlePort {
  readonly shutdown = vi.fn(async (): Promise<void> => void 0);
}

class TestWorkerLifecycle extends WorkerLifecyclePort {
  readonly close = vi.fn(async (): Promise<void> => void 0);
}

class TestWorkerTransport extends WorkerTransportPort {
  readonly handle = new TestWorkerHandle();
  readonly start = vi.fn(async (): Promise<WorkerHandlePort> => this.handle);
}

function createDeferred<T>() {
  let resolve: ((value: T | PromiseLike<T>) => void) | undefined;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });

  return {
    promise,
    resolve(value: T): void {
      if (!resolve) {
        throw new Error("Deferred promise was not initialised.");
      }

      resolve(value);
    },
  };
}

describe("WorkerRuntime", () => {
  it("starts its transport once and closes its process lifecycle", async () => {
    const lifecycle = new TestWorkerLifecycle();
    const transport = new TestWorkerTransport();
    const runtime = WorkerRuntime.create({ lifecycle, transport });

    await runtime.start();
    await runtime.start();
    await runtime.close();
    await runtime.close();

    expect(transport.start).toHaveBeenCalledOnce();
    expect(transport.handle.shutdown).toHaveBeenCalledOnce();
    expect(lifecycle.close).toHaveBeenCalledOnce();
  });

  it("shares an in-flight transport start", async () => {
    const transport = new TestWorkerTransport();
    const start = createDeferred<WorkerHandlePort>();
    transport.start.mockImplementation(() => start.promise);
    const runtime = WorkerRuntime.create({
      lifecycle: new TestWorkerLifecycle(),
      transport,
    });

    const firstStart = runtime.start();
    const secondStart = runtime.start();

    expect(transport.start).toHaveBeenCalledOnce();

    start.resolve(transport.handle);
    await Promise.all([firstStart, secondStart]);

    expect(transport.start).toHaveBeenCalledOnce();
  });

  it("allows a later start after a failed transport start", async () => {
    const transport = new TestWorkerTransport();
    transport.start.mockRejectedValueOnce(new Error("Worker transport unavailable"));
    const runtime = WorkerRuntime.create({
      lifecycle: new TestWorkerLifecycle(),
      transport,
    });

    await expect(runtime.start()).rejects.toThrow("Worker transport unavailable");
    await runtime.start();

    expect(transport.start).toHaveBeenCalledTimes(2);
  });

  it("does not start after closing", async () => {
    const runtime = WorkerRuntime.create({
      lifecycle: new TestWorkerLifecycle(),
      transport: new TestWorkerTransport(),
    });

    await runtime.close();

    await expect(runtime.start()).rejects.toThrow("Worker runtime is closed.");
  });

  it("waits for an in-flight start before closing its lifecycle", async () => {
    const phases: string[] = [];
    const lifecycle = new TestWorkerLifecycle();
    const transport = new TestWorkerTransport();
    const start = createDeferred<WorkerHandlePort>();
    transport.start.mockImplementation(() => start.promise);
    transport.handle.shutdown.mockImplementation(async () => {
      phases.push("transport");
    });
    lifecycle.close.mockImplementation(async () => {
      phases.push("lifecycle");
    });
    const runtime = WorkerRuntime.create({ lifecycle, transport });

    const starting = runtime.start();
    const firstClose = runtime.close();
    const secondClose = runtime.close();

    expect(lifecycle.close).not.toHaveBeenCalled();

    start.resolve(transport.handle);
    await Promise.all([starting, firstClose, secondClose]);

    expect(transport.handle.shutdown).toHaveBeenCalledOnce();
    expect(lifecycle.close).toHaveBeenCalledOnce();
    expect(phases).toEqual(["transport", "lifecycle"]);
  });

  it("stops the transport, closes the lifecycle, then closes owned resources", async () => {
    const phases: string[] = [];
    const lifecycle = new TestWorkerLifecycle();
    const transport = new TestWorkerTransport();
    const resources = new ResourceScope();

    transport.handle.shutdown.mockImplementation(async () => {
      phases.push("transport");
    });
    lifecycle.close.mockImplementation(async () => {
      phases.push("lifecycle");
    });
    resources.own("worker-resource", () => {
      phases.push("resource");
    });

    const runtime = WorkerRuntime.create({ lifecycle, transport, resources });

    await runtime.start();
    await runtime.close();

    expect(phases).toEqual(["transport", "lifecycle", "resource"]);
  });

  it("continues lifecycle and resource cleanup after transport shutdown fails", async () => {
    const lifecycle = new TestWorkerLifecycle();
    const transport = new TestWorkerTransport();
    const resources = new ResourceScope();
    const closeResource = vi.fn();
    const transportError = new Error("transport shutdown failed");
    transport.handle.shutdown.mockRejectedValueOnce(transportError);
    resources.own("worker-resource", closeResource);
    const runtime = WorkerRuntime.create({ lifecycle, transport, resources });

    await runtime.start();
    await expect(runtime.close()).rejects.toBe(transportError);

    expect(lifecycle.close).toHaveBeenCalledOnce();
    expect(closeResource).toHaveBeenCalledOnce();
  });

  it("continues resource cleanup after lifecycle close fails", async () => {
    const lifecycle = new TestWorkerLifecycle();
    const transport = new TestWorkerTransport();
    const resources = new ResourceScope();
    const closeResource = vi.fn();
    const lifecycleError = new Error("lifecycle close failed");
    lifecycle.close.mockRejectedValueOnce(lifecycleError);
    resources.own("worker-resource", closeResource);
    const runtime = WorkerRuntime.create({ lifecycle, transport, resources });

    await runtime.start();
    await expect(runtime.close()).rejects.toBe(lifecycleError);

    expect(transport.handle.shutdown).toHaveBeenCalledOnce();
    expect(closeResource).toHaveBeenCalledOnce();
  });

  it("leaves a shared resource scope to its parent", async () => {
    const resources = new ResourceScope();
    const closeResource = vi.fn();
    resources.own("shared-resource", closeResource);

    const runtime = WorkerRuntime.create({
      lifecycle: new TestWorkerLifecycle(),
      transport: new TestWorkerTransport(),
      resources,
      ownsResources: false,
    });

    await runtime.close();

    expect(closeResource).not.toHaveBeenCalled();

    await resources.close();

    expect(closeResource).toHaveBeenCalledOnce();
  });
});
