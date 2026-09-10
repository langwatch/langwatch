import { setTraceUrlProvider } from "@langwatch/handled-error";
import { configureLogger, createLogger, loggerConfigurationFrom } from "@langwatch/observability";
import { grafanaTraceUrlFromEnv } from "@langwatch/observability/grafana-links";
import {
  createProcessObservability,
  startOtlpMetricsExport,
  type ProcessObservability,
  type ProcessObservabilityOptions,
} from "@langwatch/observability/node";
import { GracefulShutdown, ResourceScope } from "@langwatch/runtime-composition";
import {
  SecretEnvironmentService,
  secretLogRedactPaths,
  secretResolutionSummary,
} from "@langwatch/secrets";
import { resolveWorkerConfig, type WorkerConfig } from "./platform/config/worker.config.ts";

const DRAIN_PHASE_TIMEOUT_MS = 60_000;

export type WorkerProcessComposition = {
  readonly application: WorkerApplicationLifecycle;
  /**
   * Who consumes the shared Eventing queue in this process, stated by the
   * composition that decided it. The process itself cannot know: consumer
   * ownership is a property of which graph the boot root composed, so the
   * boot log reports what the composition declares rather than asserting a
   * mode the process may not be in.
   */
  readonly eventingConsumers?: "packaged" | "app-owned";
};

export type WorkerApplicationLifecycle = {
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
    // Before the Zod parse, so every feature downstream still sees a plain
    // string and no service learns that a value came out of a vault.
    const secrets = await SecretEnvironmentService.create({ source: options.source }).resolve();
    const config = resolveWorkerConfig(secrets.environment);
    const resources = new ResourceScope();
    const loggerConfiguration = {
      ...loggerConfigurationFrom(config),
      redactPaths: secretLogRedactPaths(),
    };
    configureLogger(loggerConfiguration);
    createLogger(config.serviceName).info(
      { secrets: secretResolutionSummary(secrets) },
      "resolved secrets",
    );
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
    /**
     * Public so a launcher hosting several application graphs in one process
     * (`tools/dev-runtime`) can hand this graph's already-built observability
     * to the others, rather than each one setting the SDK up again.
     */
    readonly observability: ProcessObservability,
    readonly application: WorkerApplicationLifecycle,
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

  /**
   * `terminating` says the process is dying, which decides whether a drain past
   * its budget may have its connections taken away. Signal handlers pass it; a
   * host reusing the process does not, because someone must reclaim the handles.
   */
  close(options?: { terminating?: boolean }): Promise<void> {
    this.closing ??= this.closeProcess(options?.terminating === true);
    return this.closing;
  }

  private async closeProcess(terminating: boolean): Promise<void> {
    // Named phases on one runner, so a teardown that hangs is abandoned with
    // its name in the log. The backstop sits above any pod grace period.
    // `terminating` + `drainPhase` is what stops a timed-out drain from having
    // ClickHouse, Redis and Prisma closed underneath it — the runner's rule.
    const shutdown = GracefulShutdown.create({
      logger: this.observability.logger,
      terminating,
    })
      .phase({
        name: "application-drain",
        drainPhase: true,
        timeoutMs: DRAIN_PHASE_TIMEOUT_MS,
        run: () => this.application.drain(),
      })
      .phase({
        name: "telemetry",
        timeoutMs: DRAIN_PHASE_TIMEOUT_MS,
        run: () => this.observability.shutdown(),
      })
      .phase({
        name: "application-resources",
        timeoutMs: DRAIN_PHASE_TIMEOUT_MS,
        run: () => this.application.closeResources(),
      })
      .phase({
        name: "process-resources",
        timeoutMs: DRAIN_PHASE_TIMEOUT_MS,
        run: () => this.resources.close(),
      });

    const firstError = await shutdown.run();
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
