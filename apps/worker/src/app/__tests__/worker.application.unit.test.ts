import { describe, expect, it, vi } from "vitest";
import { WorkerApplication } from "../worker.application";
import type {
  WorkerFeatureCloser,
  WorkerFeatureInstallerPort,
} from "../../features/worker-feature.installer";
import { WorkerRuntime } from "../../platform/lifecycle/worker.runtime";
import {
  WorkerHandlePort,
  WorkerLifecyclePort,
  WorkerTransportPort,
} from "../../platform/lifecycle/worker-runtime.port";
import { WorkerEventingRuntime } from "../../platform/eventing/worker-eventing.runtime";
import { EventStoreMemory } from "@langwatch/eventing/testing";
import { InMemoryProcessStore, type EventSourcedQueueProcessor } from "@langwatch/eventing";

class Handle extends WorkerHandlePort {
  readonly shutdown = vi.fn(async (): Promise<void> => void 0);
}

class Lifecycle extends WorkerLifecyclePort {
  readonly close = vi.fn(async (): Promise<void> => void 0);
}

class Transport extends WorkerTransportPort {
  readonly handle = new Handle();
  readonly start = vi.fn(async () => this.handle);
}

class FeatureInstaller implements WorkerFeatureInstallerPort {
  readonly name = "topic";
  readonly close = vi.fn(async (): Promise<void> => void 0);
  readonly install = vi.fn(async (): Promise<WorkerFeatureCloser | undefined> => this.close);
}

class EventingQueue implements EventSourcedQueueProcessor<Record<string, unknown>> {
  constructor(private readonly phases: string[]) {}

  async send(): Promise<void> {}

  async sendBatch(): Promise<void> {}

  async waitUntilReady(): Promise<void> {}

  async close(): Promise<void> {
    this.phases.push("eventing");
  }
}

function createEventing(phases: string[]): WorkerEventingRuntime {
  return WorkerEventingRuntime.create({
    eventStore: EventStoreMemory.createForTesting(),
    queueFactory: () => new EventingQueue(phases),
    processStore: InMemoryProcessStore.createForTesting(),
    executionTarget: "worker",
    warnWhenProjectionsRunInline: false,
    consumers: { enabled: false },
  });
}

describe("WorkerApplication", () => {
  it("installs governed feature consumers before starting its runtime and closes them in reverse order", async () => {
    const transport = new Transport();
    const first = new FeatureInstaller();
    const second = new FeatureInstaller();
    const application = WorkerApplication.create({
      runtime: WorkerRuntime.create({ lifecycle: new Lifecycle(), transport }),
      featureInstallers: [first, second],
    });

    await application.start();
    await application.close();

    expect(first.install).toHaveBeenCalledBefore(transport.start);
    expect(second.install).toHaveBeenCalledBefore(transport.start);
    expect(second.close).toHaveBeenCalledBefore(first.close);
  });

  it("shares concurrent starts without registering a feature twice", async () => {
    const installer = new FeatureInstaller();
    const application = WorkerApplication.create({
      runtime: WorkerRuntime.create({ lifecycle: new Lifecycle(), transport: new Transport() }),
      featureInstallers: [installer],
    });

    await Promise.all([application.start(), application.start()]);

    expect(installer.install).toHaveBeenCalledOnce();
  });

  it("completes every feature registration before awaiting Eventing queue readiness", async () => {
    const phases: string[] = [];
    const queue = new EventingQueue(phases);
    queue.waitUntilReady = async () => {
      phases.push("ready");
    };
    const first = new FeatureInstaller();
    first.install.mockImplementation(async () => {
      phases.push("first");
      return first.close;
    });
    const second = new FeatureInstaller();
    second.install.mockImplementation(async () => {
      phases.push("second");
      return second.close;
    });
    const eventing = WorkerEventingRuntime.create({
      eventStore: EventStoreMemory.createForTesting(),
      queueFactory: () => queue,
      processStore: InMemoryProcessStore.createForTesting(),
      executionTarget: "worker",
      warnWhenProjectionsRunInline: false,
      consumers: { enabled: false },
    });
    const application = WorkerApplication.create({
      runtime: WorkerRuntime.create({ lifecycle: new Lifecycle(), transport: new Transport() }),
      eventing,
      featureInstallers: [first, second],
    });

    await application.start();

    expect(phases).toEqual(["first", "second", "ready"]);
    await application.close();
  });

  it("closes before start and rejects a later start", async () => {
    const application = WorkerApplication.create({
      runtime: WorkerRuntime.create({ lifecycle: new Lifecycle(), transport: new Transport() }),
      featureInstallers: [],
    });

    await application.close();

    await expect(application.start()).rejects.toThrow("Worker application is closed.");
  });

  it("closes an installed feature when a later installation fails", async () => {
    const first = new FeatureInstaller();
    const second = new FeatureInstaller();
    second.install.mockRejectedValueOnce(new Error("topic registration failed"));
    const application = WorkerApplication.create({
      runtime: WorkerRuntime.create({ lifecycle: new Lifecycle(), transport: new Transport() }),
      featureInstallers: [first, second],
    });

    await expect(application.start()).rejects.toThrow("topic registration failed");

    expect(first.close).toHaveBeenCalledOnce();
  });

  it("drains Eventing before deferring infrastructure teardown after a transport-start failure", async () => {
    const phases: string[] = [];
    const transport = new Transport();
    const startError = new Error("transport unavailable");
    transport.start.mockRejectedValueOnce(startError);
    const lifecycle = new Lifecycle();
    lifecycle.close.mockImplementation(async () => {
      phases.push("lifecycle");
    });
    const feature = new FeatureInstaller();
    feature.close.mockImplementation(async () => {
      phases.push("feature");
    });
    const application = WorkerApplication.create({
      runtime: WorkerRuntime.create({ lifecycle, transport }),
      eventing: createEventing(phases),
      featureInstallers: [feature],
    });

    await expect(application.start()).rejects.toBe(startError);

    expect(phases).toEqual(["eventing", "feature"]);
    await application.close();
    expect(phases).toEqual(["eventing", "feature", "lifecycle"]);
    await expect(application.start()).rejects.toThrow("Worker application is closed.");
  });

  it("drains features and defers infrastructure teardown when Eventing readiness fails", async () => {
    const phases: string[] = [];
    const readinessError = new Error("Redis is unavailable");
    const queue = new EventingQueue(phases);
    queue.waitUntilReady = async () => {
      throw readinessError;
    };
    const eventing = WorkerEventingRuntime.create({
      eventStore: EventStoreMemory.createForTesting(),
      queueFactory: () => queue,
      processStore: InMemoryProcessStore.createForTesting(),
      executionTarget: "worker",
      warnWhenProjectionsRunInline: false,
      consumers: { enabled: false },
    });
    const feature = new FeatureInstaller();
    feature.close.mockImplementation(async () => {
      phases.push("feature");
    });
    const lifecycle = new Lifecycle();
    lifecycle.close.mockImplementation(async () => {
      phases.push("lifecycle");
    });
    const transport = new Transport();
    const application = WorkerApplication.create({
      runtime: WorkerRuntime.create({ lifecycle, transport }),
      eventing,
      featureInstallers: [feature],
    });

    await expect(application.start()).rejects.toBe(readinessError);

    expect(transport.start).not.toHaveBeenCalled();
    expect(phases).toEqual(["eventing", "feature"]);
    await application.close();
    expect(phases).toEqual(["eventing", "feature", "lifecycle"]);
  });

  it("closes every feature even when one feature cleanup fails", async () => {
    const first = new FeatureInstaller();
    const second = new FeatureInstaller();
    second.close.mockRejectedValueOnce(new Error("second cleanup failed"));
    const application = WorkerApplication.create({
      runtime: WorkerRuntime.create({ lifecycle: new Lifecycle(), transport: new Transport() }),
      featureInstallers: [first, second],
    });

    await application.start();
    await expect(application.close()).rejects.toThrow("second cleanup failed");

    expect(first.close).toHaveBeenCalledOnce();
  });

  it("drains Eventing before releasing feature and runtime infrastructure", async () => {
    const phases: string[] = [];
    const feature = new FeatureInstaller();
    feature.close.mockImplementation(async () => {
      phases.push("feature");
    });
    const lifecycle = new Lifecycle();
    lifecycle.close.mockImplementation(async () => {
      phases.push("lifecycle");
    });
    const transport = new Transport();
    transport.handle.shutdown.mockImplementation(async () => {
      phases.push("transport");
    });
    const application = WorkerApplication.create({
      runtime: WorkerRuntime.create({ lifecycle, transport }),
      eventing: createEventing(phases),
      featureInstallers: [feature],
    });

    await application.start();
    await application.close();

    expect(phases).toEqual(["eventing", "feature", "transport", "lifecycle"]);
  });

  it("retains the first teardown error while completing later cleanup", async () => {
    const eventingError = new Error("eventing drain failed");
    const phases: string[] = [];
    const feature = new FeatureInstaller();
    feature.close.mockImplementation(async () => {
      phases.push("feature");
      throw new Error("feature close failed");
    });
    const lifecycle = new Lifecycle();
    lifecycle.close.mockImplementation(async () => {
      phases.push("lifecycle");
      throw new Error("lifecycle close failed");
    });
    const queue = new EventingQueue(phases);
    queue.close = async () => {
      phases.push("eventing");
      throw eventingError;
    };
    const eventing = WorkerEventingRuntime.create({
      eventStore: EventStoreMemory.createForTesting(),
      queueFactory: () => queue,
      processStore: InMemoryProcessStore.createForTesting(),
      executionTarget: "worker",
      warnWhenProjectionsRunInline: false,
      consumers: { enabled: false },
    });
    const application = WorkerApplication.create({
      runtime: WorkerRuntime.create({ lifecycle, transport: new Transport() }),
      eventing,
      featureInstallers: [feature],
    });

    await application.start();

    await expect(application.close()).rejects.toBe(eventingError);
    expect(phases).toEqual(["eventing", "feature", "lifecycle"]);
  });
});
