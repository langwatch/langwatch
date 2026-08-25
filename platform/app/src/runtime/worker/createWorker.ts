import {
  type CapabilityRegistry,
  type FeatureDefinition,
  FeatureRuntimeBuilder,
  ResourceScope,
} from "@langwatch/runtime-composition";
import type { App } from "~/server/app-layer/app";
import type { WorkerHandle } from "~/server/workers/startWorkers";

export type WorkerRuntime = {
  kind: "worker";
  services: CapabilityRegistry;
  app: App;
  start(): Promise<void>;
  close(): Promise<void>;
};

export async function createWorker({
  composeApp,
  startWorker,
  features = [],
  resources = new ResourceScope(),
  ownsResources = true,
}: {
  composeApp: () => App;
  startWorker: (app: App) => Promise<WorkerHandle>;
  features?: readonly FeatureDefinition<Record<string, never>>[];
  resources?: ResourceScope;
  ownsResources?: boolean;
}): Promise<WorkerRuntime> {
  const built = await FeatureRuntimeBuilder.create<Record<string, never>>({
    infrastructure: {},
    resources,
  }).build({ features, target: "worker" });
  const app = composeApp();
  let handle: WorkerHandle | undefined;
  let closed = false;
  return {
    kind: "worker",
    services: built.registry,
    app,
    async start() {
      if (closed) throw new Error("Worker runtime is closed.");
      handle ??= await startWorker(app);
    },
    async close() {
      if (closed) return;
      closed = true;
      await handle?.shutdown();
      await app.close({ terminating: true });
      if (ownsResources) await resources.close();
    },
  };
}
