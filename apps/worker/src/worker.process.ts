import { setTraceUrlProvider } from "@langwatch/handled-error";
import { configureLogger, loggerConfigurationFrom } from "@langwatch/observability";
import { grafanaTraceUrlFromEnv } from "@langwatch/observability/grafana-links";
import {
  createProcessObservability,
  startOtlpMetricsExport,
  type ProcessObservability,
  type ProcessObservabilityOptions,
} from "@langwatch/observability/node";
import { ResourceScope } from "@langwatch/runtime-composition";
import { resolveWorkerConfig, type WorkerConfig } from "./platform/config/worker.config";

export type WorkerProcessComposition = {
  readonly application: WorkerApplicationPort;
  /**
   * Who consumes the shared Eventing queue in this process, stated by the
   * composition that decided it. The process itself cannot know: consumer
   * ownership is a property of which graph the boot root composed, so the
   * boot log reports what the composition declares rather than asserting a
   * mode the process may not be in.
   */
  readonly eventingConsumers?: "packaged" | "app-owned";
};

export type WorkerApplicationPort = {
  start(): Promise<void>;
  drain(): Promise<void>;
  closeResources(): Promise<void>;
  close(): Promise<void>;
};

export type WorkerProcessFactoryContext = {
  readonly config: WorkerConfig;
  readonly resources: ResourceScope;
  readonly observability: ProcessObservability;
};

type WorkerProcessOptions = {
  readonly config: WorkerConfig;
  readonly resources: ResourceScope;
  readonly observability: ProcessObservability;
  readonly composition: WorkerProcessComposition;
};

export type WorkerBootOptions = {
  readonly source: Readonly<Record<string, unknown>>;
  readonly createComposition: (
    context: WorkerProcessFactoryContext,
  ) => WorkerProcessComposition | Promise<WorkerProcessComposition>;
  readonly observability?: Omit<ProcessObservabilityOptions, "serviceName" | "loggerName">;
};

/**
 * Owns the worker's process graph after configuration has been validated.
 *
 * Passing this scope to a worker runtime makes that runtime borrow it by
 * construction. That leaves this boundary with the explicit order:
 * Eventing/application drain, observability flush, technical resources.
 */
export class WorkerProcess {
  static async boot(options: WorkerBootOptions): Promise<WorkerProcess> {
    const config = resolveWorkerConfig(options.source);
    const resources = new ResourceScope();
    const loggerConfiguration = loggerConfigurationFrom(config);
    configureLogger(loggerConfiguration);
    // The Grafana trace link every serialized HandledError carries. The
    // package defaults to a no-op provider, so without this registration a
    // customer-visible error reaches support with no way back to its trace.
    // Registration only stores the function — `serialize()` reads the
    // environment per call, so this is safe before the config phase.
    setTraceUrlProvider(grafanaTraceUrlFromEnv);
    // Before anything records: the instruments resolve a meter once at module
    // scope, so a counter touched ahead of this line writes into a no-op for
    // the life of the process. This process serves no Prometheus registry, so
    // without this its metrics exist nowhere.
    const metrics = startOtlpMetricsExport(config.otlpMetrics);
    const observability = createProcessObservability({
      ...options.observability,
      serviceName: config.serviceName,
      loggerName: config.serviceName,
      setup: options.observability?.setup ?? toObservabilitySetup(config),
      flushers: [...(options.observability?.flushers ?? []), ...(metrics ? [metrics] : [])],
    });

    try {
      const composition = await options.createComposition({
        config,
        resources,
        observability,
      });
      observability.logger.info(
        { eventingConsumers: composition.eventingConsumers ?? "unstated" },
        "worker composition ready",
      );
      return WorkerProcess.create({ config, resources, observability, composition });
    } catch (error) {
      await observability.shutdown().catch(() => void 0);
      await resources.close().catch(() => void 0);
      throw error;
    }
  }

  private static create(options: WorkerProcessOptions): WorkerProcess {
    return new WorkerProcess(
      options.config,
      options.resources,
      options.observability,
      options.composition.application,
    );
  }

  private closing: Promise<void> | undefined;

  private constructor(
    readonly config: WorkerConfig,
    private readonly resources: ResourceScope,
    private readonly observability: ProcessObservability,
    readonly application: WorkerApplicationPort,
  ) {}

  get logger(): ProcessObservability["logger"] {
    return this.observability.logger;
  }

  async start(): Promise<void> {
    try {
      await this.application.start();
    } catch (error) {
      await this.close().catch(() => void 0);
      throw error;
    }
  }

  close(): Promise<void> {
    this.closing ??= this.closeProcess();
    return this.closing;
  }

  private async closeProcess(): Promise<void> {
    let firstError: unknown;

    try {
      await this.application.drain();
    } catch (error) {
      firstError = error;
    }

    try {
      await this.observability.shutdown();
    } catch (error) {
      firstError ??= error;
    }

    try {
      await this.application.closeResources();
    } catch (error) {
      firstError ??= error;
    }

    try {
      await this.resources.close();
    } catch (error) {
      firstError ??= error;
    }

    if (firstError) throw firstError;
  }
}

/**
 * Resolves config before creating telemetry, resources, or the application.
 * This is the reusable boot seam for the executable and for process tests.
 */
export async function bootWorker(options: WorkerBootOptions): Promise<WorkerProcess> {
  return WorkerProcess.boot(options);
}

function toObservabilitySetup(config: WorkerConfig): ProcessObservabilityOptions["setup"] {
  const langwatch = config.observability.apiKey
    ? {
        apiKey: config.observability.apiKey,
        endpoint: config.observability.endpoint,
        processorType: config.observability.processorType,
      }
    : ("disabled" as const);

  return {
    langwatch,
    attributes: {
      "deployment.environment.name": config.environment,
      ...(config.serviceVersion ? { "service.version": config.serviceVersion } : {}),
    },
  };
}
