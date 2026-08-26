import {
  ApiApplicationPort,
  ApiLifecyclePort,
  ApiRuntime,
  type ApiShutdownOptions,
} from "@langwatch/platform-api/runtime";
import {
  type CapabilityRegistry,
  type FeatureDefinition,
  FeatureRuntimeBuilder,
  type ResourceScope,
} from "@langwatch/runtime-composition";
import type { App } from "~/server/app-layer/app";
import { appFeatures } from "./features";

/** The temporary application adapter while platform/app still owns the graph. */
class LegacyAppApplication extends ApiApplicationPort<App> {
  static create(composeApp: () => App): LegacyAppApplication {
    return new LegacyAppApplication(composeApp);
  }

  private app: App | undefined;

  private constructor(private readonly composeApp: () => App) {
    super();
  }

  get application(): App {
    const app = this.app;
    if (!app) {
      throw new Error("Legacy App has not been composed.");
    }
    return app;
  }

  async compose(): Promise<void> {
    this.app = this.composeApp();
  }

  async start(): Promise<void> {}

  close(options?: ApiShutdownOptions): Promise<void> {
    return this.application.close(options);
  }
}

class LegacyAppFeatureLifecycle extends ApiLifecyclePort<CapabilityRegistry> {
  static create(
    features: readonly FeatureDefinition<Record<string, never>>[],
  ): LegacyAppFeatureLifecycle {
    return new LegacyAppFeatureLifecycle(features);
  }

  private constructor(
    private readonly features: readonly FeatureDefinition<Record<string, never>>[],
  ) {
    super();
  }

  async compose(resources: ResourceScope): Promise<CapabilityRegistry> {
    const built = await FeatureRuntimeBuilder.create<Record<string, never>>({
      infrastructure: {},
      resources,
    }).build({ features: this.features, target: "app" });

    return built.registry;
  }
}

export type AppRuntime = ApiRuntime<App, CapabilityRegistry>;

export async function createLegacyAppRuntime({
  composeApp,
  features = appFeatures,
  resources,
  ownsResources,
}: {
  composeApp: () => App;
  features?: readonly FeatureDefinition<Record<string, never>>[];
  resources?: ResourceScope;
  ownsResources?: boolean;
}): Promise<AppRuntime> {
  return ApiRuntime.create({
    application: LegacyAppApplication.create(composeApp),
    lifecycle: LegacyAppFeatureLifecycle.create(features),
    resources,
    ownsResources,
  });
}
