import type { App } from "~/server/app-layer/app";
import type { WorkerHandle } from "~/server/workers/startWorkers";
import { buildFeatureRuntime, type FeatureDefinition } from "../shared/feature";
import { ResourceScope } from "../shared/resource-scope";

export type WorkerRuntime = {
  kind: "worker";
  services: Awaited<ReturnType<typeof buildFeatureRuntime>>["registry"];
  legacy: App;
  start(): Promise<void>;
  close(): Promise<void>;
};

export async function createWorker({
  initializeLegacy,
  startLegacy,
  features = [],
  resources = new ResourceScope(),
  ownsResources = true,
}: {
  initializeLegacy: () => App;
  startLegacy: () => Promise<WorkerHandle>;
  features?: readonly FeatureDefinition<Record<string, never>>[];
  resources?: ResourceScope;
  ownsResources?: boolean;
}): Promise<WorkerRuntime> {
  const built = await buildFeatureRuntime({
    features,
    infrastructure: {},
    target: "worker",
    resources,
  });
  const legacy = initializeLegacy();
  let handle: WorkerHandle | undefined;
  let closed = false;
  return {
    kind: "worker",
    services: built.registry,
    legacy,
    async start() {
      if (closed) throw new Error("Worker runtime is closed.");
      handle ??= await startLegacy();
    },
    async close() {
      if (closed) return;
      closed = true;
      await handle?.shutdown();
      await legacy.close({ terminating: true });
      if (ownsResources) await resources.close();
    },
  };
}
