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
});
