import { describe, expect, it, vi } from "vitest";
import { WorkerApplication } from "../src/app/worker.application";
import {
  WorkerFeatureHandlePort,
  WorkerFeatureInstallerPort,
} from "../src/features/worker-feature.installer";
import { WorkerRuntime } from "../src/platform/lifecycle/worker.runtime";
import {
  WorkerHandlePort,
  WorkerLifecyclePort,
  WorkerTransportPort,
} from "../src/platform/lifecycle/worker-runtime.port";
import { WorkerEventingRuntime } from "../src/platform/eventing/worker-eventing.runtime";
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

class FeatureHandle extends WorkerFeatureHandlePort {
  readonly close = vi.fn(async (): Promise<void> => void 0);
}

class FeatureInstaller extends WorkerFeatureInstallerPort {
  readonly name = "topic";
  readonly handle = new FeatureHandle();
  readonly install = vi.fn(async () => this.handle);
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
    eventStore: new EventStoreMemory(),
    queueFactory: () => new EventingQueue(phases),
    processStore: new InMemoryProcessStore(),
    executionTarget: "worker",
    consumersEnabled: false,
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
    expect(second.handle.close).toHaveBeenCalledBefore(first.handle.close);
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

    expect(first.handle.close).toHaveBeenCalledOnce();
  });

  it("closes every feature even when one feature cleanup fails", async () => {
    const first = new FeatureInstaller();
    const second = new FeatureInstaller();
    second.handle.close.mockRejectedValueOnce(new Error("second cleanup failed"));
    const application = WorkerApplication.create({
      runtime: WorkerRuntime.create({ lifecycle: new Lifecycle(), transport: new Transport() }),
      featureInstallers: [first, second],
    });

    await application.start();
    await expect(application.close()).rejects.toThrow("second cleanup failed");

    expect(first.handle.close).toHaveBeenCalledOnce();
  });

  it("drains Eventing before releasing feature and runtime infrastructure", async () => {
    const phases: string[] = [];
    const feature = new FeatureInstaller();
    feature.handle.close.mockImplementation(async () => {
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
    feature.handle.close.mockImplementation(async () => {
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
      eventStore: new EventStoreMemory(),
      queueFactory: () => queue,
      processStore: new InMemoryProcessStore(),
      executionTarget: "worker",
      consumersEnabled: false,
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
