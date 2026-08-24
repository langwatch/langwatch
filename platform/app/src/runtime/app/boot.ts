import {
  RuntimeBoot,
  type BootedRuntime,
  type ResourceScope,
} from "@langwatch/runtime-composition";
import type { AppBootConfig } from "../config";
import { AppBootConfigService } from "../config";

export type AppComposition = {
  start(): void | Promise<void>;
  close(): void | Promise<void>;
};

export type AppBootOptions = {
  compose(config: AppBootConfig, resources: ResourceScope): AppComposition | Promise<AppComposition>;
  checkReadiness?: (app: AppComposition, config: AppBootConfig) => void | Promise<void>;
  config?: AppBootConfigService;
};

/** Application executable seam used by server entrypoints during migration. */
export class AppBoot {
  private readonly runtime: RuntimeBoot<AppBootConfig, AppComposition>;

  constructor(options: AppBootOptions) {
    this.runtime = new RuntimeBoot({
      config: options.config ?? new AppBootConfigService(),
      createApplication: (config, _infrastructure, resources) => options.compose(config, resources),
      checkReadiness: (app, config) => options.checkReadiness?.(app, config),
      startTransport: async (app) => {
        await app.start();
      },
    });
  }

  boot(source: Readonly<Record<string, unknown>>): Promise<BootedRuntime<AppBootConfig, AppComposition>> {
    return this.runtime.boot(source);
  }
}
