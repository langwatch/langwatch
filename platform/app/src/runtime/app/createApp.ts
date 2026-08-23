import type { App } from "~/server/app-layer/app";
import { buildFeatureRuntime, type FeatureDefinition } from "../shared/feature";
import { ResourceScope } from "../shared/resource-scope";
import { appFeatures } from "./features";

export type AppRuntime = {
  kind: "app";
  services: Awaited<ReturnType<typeof buildFeatureRuntime>>["registry"];
  legacy: App;
  start(): Promise<void>;
  close(options?: { terminating?: boolean }): Promise<void>;
};

export async function createApp({
  initializeLegacy,
  features = appFeatures,
  resources = new ResourceScope(),
  ownsResources = true,
}: {
  initializeLegacy: () => App;
  features?: readonly FeatureDefinition<Record<string, never>>[];
  resources?: ResourceScope;
  ownsResources?: boolean;
}): Promise<AppRuntime> {
  const built = await buildFeatureRuntime({
    features,
    infrastructure: {},
    target: "app",
    resources,
  });
  const legacy = initializeLegacy();
  let closed = false;
  return {
    kind: "app",
    services: built.registry,
    legacy,
    async start() {
      if (closed) throw new Error("App runtime is closed.");
    },
    async close(options) {
      if (closed) return;
      closed = true;
      await legacy.close(options);
      if (ownsResources) await resources.close();
    },
  };
}
