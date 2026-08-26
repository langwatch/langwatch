import { ResourceScope } from "@langwatch/runtime-composition";
import type { AppRuntime } from "../app/legacy-app.application";
import type { WorkerRuntime } from "@langwatch/worker/runtime";

export type CombinedRuntime = {
  app: AppRuntime;
  worker: WorkerRuntime;
  close(): Promise<void>;
};

export async function createCombined({
  createApp,
  createWorker,
  resources = new ResourceScope(),
}: {
  createApp: (resources: ResourceScope) => Promise<AppRuntime>;
  createWorker: (resources: ResourceScope) => Promise<WorkerRuntime>;
  resources?: ResourceScope;
}): Promise<CombinedRuntime> {
  const app = await createApp(resources);
  const worker = await createWorker(resources);
  let closed = false;
  return {
    app,
    worker,
    async close() {
      if (closed) return;
      closed = true;
      await worker.close();
      await app.close();
      await resources.close();
    },
  };
}
