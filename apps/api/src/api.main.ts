import { configureLogger, createLogger, type Logger } from "@langwatch/observability";
import type { ProcessObservabilityOptions } from "@langwatch/observability/node";
import { ResourceScope } from "@langwatch/runtime-composition";
import { ApiProcessGraphPort } from "./api.process";
import {
  apiObservabilityConfiguration,
  apiLoggerConfiguration,
  resolveApiConfig,
  type ApiConfig,
} from "./platform/config/api.config";
import { installApiSignalHandlers, type ApiSignalHandlerOptions } from "./api.signal-handlers";

/** The closed API process built by a runtime composition root. */
export abstract class ApiRuntimeProcessPort {
  abstract start(): Promise<unknown>;

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
    const observability: ProcessObservabilityOptions = {
      ...configuredObservability,
      ...options.observability,
      setup: options.observability?.setup ?? configuredObservability.setup,
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

  start(): Promise<unknown> {
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
