import { configureLogger, type LoggerConfiguration } from "@langwatch/observability";
import {
  createProcessObservability,
  type ProcessObservability,
  type ProcessObservabilityOptions,
} from "@langwatch/observability/node";
import { ResourceScope } from "@langwatch/runtime-composition";
import { resolveWorkerConfig, type WorkerConfig } from "./platform/config/worker.config";

export type WorkerProcessComposition = {
  readonly application: WorkerApplicationPort;
};

export type WorkerApplicationPort = {
  start(): Promise<void>;
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
 * Eventing/application drain, technical resources, observability flush.
 */
export class WorkerProcess {
  static async boot(options: WorkerBootOptions): Promise<WorkerProcess> {
    const config = resolveWorkerConfig(options.source);
    const resources = new ResourceScope();
    const loggerConfiguration = toLoggerConfiguration(config);
    configureLogger(loggerConfiguration);
    const observability = createProcessObservability({
      ...options.observability,
      serviceName: config.serviceName,
      loggerName: config.serviceName,
      setup: options.observability?.setup ?? toObservabilitySetup(config),
    });

    observability.logger.info(
      {
        consumersEnabled: config.eventing.consumersEnabled,
        mode: "producer-only",
      },
      "worker Eventing consumer is disabled until the complete registry is mounted",
    );

    try {
      const composition = await options.createComposition({
        config,
        resources,
        observability,
      });
      return WorkerProcess.create({ config, resources, observability, composition });
    } catch (error) {
      await resources.close().catch(() => void 0);
      await observability.shutdown().catch(() => void 0);
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
      await this.application.close();
    } catch (error) {
      firstError = error;
    }

    try {
      await this.resources.close();
    } catch (error) {
      firstError ??= error;
    }

    try {
      await this.observability.shutdown();
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

function toLoggerConfiguration(config: WorkerConfig): LoggerConfiguration {
  return {
    environment: config.nodeEnvironment,
    format: config.logger.format,
    level: config.logger.level,
    consoleLevel: config.logger.consoleLevel,
    otelExportEnabled: config.logger.otelExportEnabled,
    serviceName: config.serviceName,
    serviceVersion: config.serviceVersion,
    deploymentEnvironment: config.environment,
  };
}
