import {
  WorkerHandlePort,
  WorkerLifecyclePort,
  WorkerTransportPort,
} from "@langwatch/worker/runtime";
import type { App } from "~/server/app-layer/app";
import { startWorkers, type WorkerHandle } from "~/server/workers/startWorkers";

class LegacyWorkerHandleAdapter extends WorkerHandlePort {
  constructor(private readonly handle: WorkerHandle) {
    super();
  }

  async shutdown(): Promise<void> {
    await this.handle.shutdown();
  }
}

class LegacyWorkerLifecycleAdapter extends WorkerLifecyclePort {
  constructor(private readonly app: App) {
    super();
  }

  async close(): Promise<void> {
    await this.app.close({ terminating: true });
  }
}

class LegacyWorkerTransportAdapter extends WorkerTransportPort {
  constructor(private readonly app: App) {
    super();
  }

  async start(): Promise<WorkerHandlePort> {
    const handle = await startWorkers({
      shouldStartMetricsServer: true,
      app: this.app,
    });

    return new LegacyWorkerHandleAdapter(handle);
  }
}

export function createLegacyWorkerPorts(app: App): {
  lifecycle: WorkerLifecyclePort;
  transport: WorkerTransportPort;
} {
  return {
    lifecycle: new LegacyWorkerLifecycleAdapter(app),
    transport: new LegacyWorkerTransportAdapter(app),
  };
}
