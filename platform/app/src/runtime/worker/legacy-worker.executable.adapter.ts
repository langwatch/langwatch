import {
  WorkerExecutableCompositionPort,
  type WorkerApplicationPort,
  type WorkerProcessComposition,
  type WorkerProcessFactoryContext,
} from "@langwatch/worker";
import { AppBoot } from "~/runtime/app/boot";
import { AppBootConfigService, fixedAppBootConfigResolver } from "~/runtime/config";

/**
 * Compatibility composition for the complete legacy Eventing registry.
 *
 * The physical Worker owns process boot and shutdown. This adapter remains
 * only until every shared-queue pipeline moves: AppBoot still constructs the
 * legacy graph and starts its transport before the Worker can own it directly.
 */
export class LegacyWorkerExecutableComposition extends WorkerExecutableCompositionPort {
  static create(options: {
    source: Readonly<Record<string, unknown>>;
  }): LegacyWorkerExecutableComposition {
    return new LegacyWorkerExecutableComposition(options.source);
  }

  async compose(_context: WorkerProcessFactoryContext): Promise<WorkerProcessComposition> {
    const appConfig = new AppBootConfigService().resolve(this.source);
    const appBoot = new AppBoot({
      config: fixedAppBootConfigResolver(appConfig),
      compose: async (_config, resources) => {
        const { WorkerRuntime } = await import("@langwatch/worker/runtime");
        const { createLegacyWorkerPorts } = await import("./legacy-worker.adapter");
        const { initializeWorkerApp } = await import("~/server/app-layer/presets");
        const app = initializeWorkerApp();
        const ports = createLegacyWorkerPorts(app);
        const runtime = WorkerRuntime.create({ ...ports, resources });
        return {
          start: () => runtime.start(),
          close: () => runtime.close(),
        };
      },
    });
    const booted = await appBoot.boot({});
    return { application: LegacyBootedWorkerApplication.create(booted.close) };
  }

  private constructor(private readonly source: Readonly<Record<string, unknown>>) {
    super();
  }
}

class LegacyBootedWorkerApplication implements WorkerApplicationPort {
  static create(close: () => Promise<void>): LegacyBootedWorkerApplication {
    return new LegacyBootedWorkerApplication(close);
  }

  private closing: Promise<void> | undefined;

  private constructor(private readonly closeLegacyGraph: () => Promise<void>) {}

  async start(): Promise<void> {
    // AppBoot already started the complete legacy registry while composing.
  }

  drain(): Promise<void> {
    this.closing ??= this.closeLegacyGraph();
    return this.closing;
  }

  async closeResources(): Promise<void> {
    // Legacy AppBoot owns its scope and releases it during drain above.
  }

  close(): Promise<void> {
    return this.drain();
  }
}
