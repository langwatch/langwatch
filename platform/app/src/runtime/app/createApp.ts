import {
  type CapabilityRegistry,
  type FeatureDefinition,
  FeatureRuntimeBuilder,
  ResourceScope,
} from "@langwatch/runtime-composition";
import type { App } from "~/server/app-layer/app";
import { appFeatures } from "./features";

export type AppRuntime = {
  kind: "app";
  services: CapabilityRegistry;
  app: App;
  start(): Promise<void>;
  close(options?: { terminating?: boolean }): Promise<void>;
};

export async function createApp({
  composeApp,
  features = appFeatures,
  resources = new ResourceScope(),
  ownsResources = true,
}: {
  composeApp: () => App;
  features?: readonly FeatureDefinition<Record<string, never>>[];
  resources?: ResourceScope;
  ownsResources?: boolean;
}): Promise<AppRuntime> {
  const built = await FeatureRuntimeBuilder.create<Record<string, never>>({
    infrastructure: {},
    resources,
  }).build({ features, target: "app" });
  const app = composeApp();
  let closed = false;
  return {
    kind: "app",
    services: built.registry,
    app,
    async start() {
      if (closed) throw new Error("App runtime is closed.");
    },
    async close(options) {
      if (closed) return;
      closed = true;
      await app.close(options);
      if (ownsResources) await resources.close();
    },
  };
}
