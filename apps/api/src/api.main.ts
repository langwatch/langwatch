import { setTraceUrlProvider } from "@langwatch/handled-error";
import { configureLogger, createLogger, type Logger } from "@langwatch/observability";
import { grafanaTraceUrlFromEnv } from "@langwatch/observability/grafana-links";
import {
  startOtlpMetricsExport,
  type ProcessObservabilityOptions,
} from "@langwatch/observability/node";
import {
  ResourceScope,
  RuntimeLifecycle,
  cleanupAfterFailure,
} from "@langwatch/runtime-composition";
import {
  SecretEnvironmentService,
  secretLogRedactPaths,
  secretResolutionSummary,
} from "@langwatch/secrets";
import {
  apiObservabilityConfiguration,
  apiLoggerConfiguration,
  resolveApiConfig,
  type ApiConfig,
} from "./platform/config/api.config.ts";
import { installApiSignalHandlers, type ApiSignalHandlerOptions } from "./api.signal-handlers.ts";

/** The address a started API process is listening on, when it binds one. */
export type ApiListenerAddress = Readonly<{ host: string; port: number }>;

/** The closed API process built by a runtime composition root. */
export abstract class ApiRuntimeProcess {
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
  /** Every secret this process resolved, as the members are built from. */
  secrets: Readonly<Record<string, string>>;
  observability: ProcessObservabilityOptions;
  resources: ResourceScope;
};

export abstract class ApiRuntimeComposition {
  abstract compose(options: ApiRuntimeCompositionOptions): Promise<ApiRuntimeProcess>;
}

export type ApiRuntimeBootstrapOptions = {
  source: Readonly<Record<string, unknown>>;
  composition: ApiRuntimeComposition;
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
    // Before the Zod parse, so every feature downstream still sees a plain
    // string and no service learns that a value came out of a vault.
    const secrets = await SecretEnvironmentService.create({ source: options.source }).resolve();
    const config = resolveApiConfig(secrets.environment);
    const loggerConfiguration = {
      ...apiLoggerConfiguration(config),
      redactPaths: secretLogRedactPaths(),
    };
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
    // The Grafana trace link every serialized HandledError carries. The
    // package defaults to a no-op provider, so without this registration a
    // customer-visible error reaches support with no way back to its trace.
    // Registration only stores the function — `serialize()` reads the
    // environment per call, so this is safe before the config phase.
    setTraceUrlProvider(grafanaTraceUrlFromEnv);
    createLogger(config.serviceName).info(
      { secrets: secretResolutionSummary(secrets) },
      "resolved secrets",
    );

    const resources = new ResourceScope();
    const graph = ScopedApiProcessGraph.create(resources);

    try {
      const process = await options.composition.compose({
        config,
        secrets: resolvedSecretValues(secrets.environment),
        observability,
        resources,
      });
      graph.seal();
      const main = new ApiRuntimeBootstrap(
        config,
        process,
        createLogger(config.serviceName),
        graph,
      );
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
  private starting: Promise<ApiListenerAddress | undefined> | undefined;
  private cleanup: Promise<void> | undefined;
  private disposeSignals: (() => void) | undefined;

  private constructor(
    readonly config: ApiConfig,
    readonly process: ApiRuntimeProcess,
    private readonly logger: Pick<Logger, "error" | "info">,
    private readonly graph: ScopedApiProcessGraph,
  ) {}

  start(): Promise<ApiListenerAddress | undefined> {
    if (this.closing) return Promise.reject(new Error("Cannot start a closed API runtime."));

    this.starting ??= this.startProcess();
    return this.starting;
  }

  private async startProcess(): Promise<ApiListenerAddress | undefined> {
    try {
      await this.graph.start();
      return await this.process.start();
    } catch (error) {
      return cleanupAfterFailure(error, () => this.cleanupProcess());
    }
  }

  private cleanupProcess(): Promise<void> {
    this.cleanup ??= Promise.resolve().then(async () => {
      const cleanup = new ResourceScope();
      cleanup.own("API graph", () => this.graph.close());
      cleanup.own("API process", () => this.process.close());
      try {
        await cleanup.close();
      } finally {
        this.disposeSignals?.();
      }
    });
    return this.cleanup;
  }

  close(): Promise<void> {
    this.closing ??= this.closeMain();
    return this.closing;
  }

  private async closeMain(): Promise<void> {
    await this.starting?.catch(() => void 0);
    await this.cleanupProcess();
  }
}

async function closeGraphAfterCompositionFailure(
  graph: ScopedApiProcessGraph,
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

class ScopedApiProcessGraph {
  private lifecycle: RuntimeLifecycle | undefined;
  private closing: Promise<void> | undefined;

  static create(resources: ResourceScope): ScopedApiProcessGraph {
    return new ScopedApiProcessGraph(resources);
  }

  private constructor(private readonly resources: ResourceScope) {}

  private runtime(): RuntimeLifecycle {
    this.lifecycle ??= new RuntimeLifecycle(this.resources.sealServices(), new ResourceScope());
    return this.lifecycle;
  }

  seal(): void {
    this.runtime();
  }

  start(): Promise<void> {
    return this.runtime().start();
  }

  drain(): Promise<void> {
    return this.runtime().stop();
  }

  close(): Promise<void> {
    this.closing ??= Promise.resolve().then(async () => {
      const cleanup = new ResourceScope();
      cleanup.own("API infrastructure", () => this.resources.close());
      cleanup.own("API feature services", () => this.drain());
      await cleanup.close();
    });
    return this.closing;
  }
}

/**
 * The resolved environment, narrowed to the string values a member is built
 * from. Anything else was never a secret this process can hand on.
 */
function resolvedSecretValues(
  environment: Readonly<Record<string, unknown>>,
): Readonly<Record<string, string>> {
  const values: Record<string, string> = {};
  for (const [key, value] of Object.entries(environment)) {
    if (typeof value === "string") values[key] = value;
  }
  return values;
}
