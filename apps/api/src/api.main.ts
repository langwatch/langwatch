import { configureLogger, createLogger, type Logger } from "@langwatch/observability";
import {
  startOtlpMetricsExport,
  type ProcessObservabilityOptions,
} from "@langwatch/observability/node";
import { ResourceScope } from "@langwatch/runtime-composition";
import { ApiProcessGraphPort } from "./api.process";
import {
  apiObservabilityConfiguration,
  apiLoggerConfiguration,
  resolveApiConfig,
  type ApiConfig,
} from "./platform/config/api.config";
import { installApiSignalHandlers, type ApiSignalHandlerOptions } from "./api.signal-handlers";

/** The address a started API process is listening on, when it binds one. */
export type ApiListenerAddress = Readonly<{ host: string; port: number }>;

/** The closed API process built by a runtime composition root. */
export abstract class ApiRuntimeProcessPort {
  /**
   * The bound address, or nothing for a process composed without a listener.
   *
   * Declared rather than left as `unknown`: every implementation answers this
   * shape, and a caller that has to reach for the port a test binds could not
   * read it through the port at all.
   */
  abstract start(): Promise<ApiListenerAddress | undefined>;

  abstract close(): Promise<void>;
}

/**
 * Composition supplies one complete API graph after configuration has been
 * validated. It receives the process-owned scope rather than reaching for a
 * global App or persistence client.
 */
export type ApiRuntimeCompositionOptions = {
  config: ApiConfig;
  graph: ApiProcessGraphPort;
  observability: ProcessObservabilityOptions;
  resources: ResourceScope;
};

export abstract class ApiRuntimeCompositionPort {
  abstract compose(options: ApiRuntimeCompositionOptions): Promise<ApiRuntimeProcessPort>;
}

export type ApiRuntimeBootstrapOptions = {
  source: Readonly<Record<string, unknown>>;
  composition: ApiRuntimeCompositionPort;
  observability?: Omit<ProcessObservabilityOptions, "serviceName" | "loggerName">;
  signals?: false | Omit<ApiSignalHandlerOptions, "close" | "logger">;
};

/**
 * Injectable API runtime foundation: parse once, configure logging, compose
 * one graph, and retain its ResourceScope until process shutdown completes.
 *
 * A physical executable supplies the complete composition port and calls
 * `startApiExecutable`. This foundation does not import legacy feature graph
 * construction, so it cannot accidentally launch a partial second process.
 */
export class ApiRuntimeBootstrap {
  static async create(options: ApiRuntimeBootstrapOptions): Promise<ApiRuntimeBootstrap> {
    const config = resolveApiConfig(options.source);
    const loggerConfiguration = apiLoggerConfiguration(config);
    const configuredObservability = apiObservabilityConfiguration(config);
    // Metrics are their own provider, installed before anything records into
    // it: the instruments resolve a meter once at module scope, so a counter
    // touched before this line writes into a no-op for the life of the
    // process. The handle it returns is a shutdown phase, not a signal
    // handler — the drain below is what decides when this process ends.
    const metrics = startOtlpMetricsExport(config.otlpMetrics);
    const observability: ProcessObservabilityOptions = {
      ...configuredObservability,
      ...options.observability,
      setup: options.observability?.setup ?? configuredObservability.setup,
      flushers: [...(options.observability?.flushers ?? []), ...(metrics ? [metrics] : [])],
    };
    configureLogger(loggerConfiguration);

    const resources = new ResourceScope();
    const graph = ScopedApiProcessGraph.create(resources);

    try {
      const process = await options.composition.compose({
        config,
        graph,
        observability,
        resources,
      });
      const main = new ApiRuntimeBootstrap(config, process, createLogger(config.serviceName));
      if (options.signals !== false) {
        main.disposeSignals = installApiSignalHandlers({
          ...options.signals,
          deadlineMs: options.signals?.deadlineMs ?? config.shutdown.processDeadlineMs,
          close: () => main.close(),
          logger: main.logger,
        });
      }
      return main;
    } catch (error) {
      await closeGraphAfterCompositionFailure(graph, error, createLogger(config.serviceName));
      throw error;
    }
  }

  private closing: Promise<void> | undefined;
  private disposeSignals: (() => void) | undefined;

  private constructor(
    readonly config: ApiConfig,
    readonly process: ApiRuntimeProcessPort,
    private readonly logger: Pick<Logger, "error" | "info">,
  ) {}

  start(): Promise<ApiListenerAddress | undefined> {
    return this.process.start();
  }

  close(): Promise<void> {
    this.closing ??= this.closeMain();
    return this.closing;
  }

  private async closeMain(): Promise<void> {
    try {
      await this.process.close();
    } finally {
      this.disposeSignals?.();
    }
  }
}

async function closeGraphAfterCompositionFailure(
  graph: ApiProcessGraphPort,
  bootError: unknown,
  logger: Pick<Logger, "error">,
): Promise<void> {
  try {
    await graph.close();
  } catch (closeError) {
    logger.error(
      { error: closeError, bootError },
      "API resource cleanup failed after composition failure",
    );
  }
}

class ScopedApiProcessGraph extends ApiProcessGraphPort {
  static create(resources: ResourceScope): ScopedApiProcessGraph {
    return new ScopedApiProcessGraph(resources);
  }

  private constructor(private readonly resources: ResourceScope) {
    super();
  }

  close(): Promise<void> {
    return this.resources.close();
  }
}
