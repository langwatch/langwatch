import process from "node:process";

import { setTraceUrlProvider } from "@langwatch/handled-error";
import { ResourceScope } from "@langwatch/kernel";
import { configureLogger, createLogger, type Logger } from "@langwatch/observability";
import { grafanaTraceUrlFromEnv } from "@langwatch/observability/grafana-links";
import {
  startOtlpMetricsExport,
  type ProcessObservabilityOptions,
} from "@langwatch/observability/node";
import {
  SecretEnvironmentService,
  secretLogRedactPaths,
  secretResolutionSummary,
} from "@langwatch/secrets";

import { GracefulShutdown } from "./graceful-shutdown.ts";

/** Read off the functions themselves, so a change to either is a compile error here. */
type LoggerConfiguration = Parameters<typeof configureLogger>[0];
type OtlpMetricsConfig = Parameters<typeof startOtlpMetricsExport>[0];

/**
 * What a process states about itself once its environment has been resolved:
 * its parsed config plus the four process-level facts derived from it. One
 * function, so a process says all of this in one place or not at all.
 */
export type ServerPlan<TConfig> = Readonly<{
  config: TConfig;
  serviceName: string;
  logging: LoggerConfiguration;
  observability: ProcessObservabilityOptions;
  metrics?: OtlpMetricsConfig;
  /** The watchdog ceiling for the whole teardown. Absent, there is no watchdog. */
  shutdownDeadlineMs?: number;
}>;

export type ServerOptions<TConfig> = Readonly<{
  /** Names the process in fatal lines written before config resolves. */
  name: string;
  source?: Readonly<Record<string, unknown>>;
  plan: (environment: Readonly<Record<string, unknown>>) => ServerPlan<TConfig>;
  /**
   * Whether this server owns SIGTERM/SIGINT. An embedded server shares a
   * process with another and must not race it to the exit, so it passes false.
   */
  signals?: boolean;
  /**
   * Reuses an observability graph another application in this process already
   * built. Setting the SDK up twice is what prints "already set up".
   */
  observability?: Partial<ProcessObservabilityOptions>;
  exit?: (code: number) => never;
}>;

/**
 * One thing the server hosts. Components start in the order they were hosted
 * and stop in the reverse, because each is built on the one before it.
 */
export type ServerComponent = Readonly<{
  name: string;
  start?: () => void | Promise<void>;
  stop: () => void | Promise<void>;
  /**
   * Marks the component that drains live work rather than releasing handles.
   * A drain that outruns its budget is still running, so a terminating server
   * leaves it to process teardown instead of severing it.
   */
  drain?: boolean;
  timeoutMs?: number;
}>;

/**
 * The process, as a thing that exists before its application does.
 *
 * `start` brings up telemetry and the fatal handlers FIRST, so a failure to
 * parse config is logged and traced rather than vanishing into a process with
 * no observability. Config is resolved second. The application is composed
 * afterwards and mounted with {@link host}.
 */
export class Server<TConfig> {
  static async start<TConfig>(options: ServerOptions<TConfig>): Promise<Server<TConfig>> {
    const exit = options.exit ?? (process.exit.bind(process) as (code: number) => never);
    // Before any await: an unhandled rejection during secret resolution would
    // otherwise kill the process with Node's default handler and no log line.
    const bootFatal = installFatalHandlers({ service: options.name, log: undefined, exit });

    try {
      // Before the Zod parse, so every feature downstream still sees a plain
      // string and no service learns a value came out of a vault.
      const secrets = await SecretEnvironmentService.create({
        source: options.source ?? process.env,
      }).resolve();
      const plan = options.plan(secrets.environment);

      // Metrics are their own provider and must exist before anything records
      // into it: instruments resolve a meter once at module scope, so a counter
      // touched before this line writes to a no-op for the life of the process.
      const metrics = plan.metrics === undefined ? undefined : startOtlpMetricsExport(plan.metrics);
      const observability: ProcessObservabilityOptions = {
        ...plan.observability,
        ...options.observability,
        setup: options.observability?.setup ?? plan.observability.setup,
        flushers: [
          ...(options.observability?.flushers ?? plan.observability.flushers ?? []),
          ...(metrics ? [metrics] : []),
        ],
      };

      configureLogger({ ...plan.logging, redactPaths: secretLogRedactPaths() });
      // The Grafana link every serialized HandledError carries. Without this a
      // customer-visible error reaches support with no way back to its trace.
      setTraceUrlProvider(grafanaTraceUrlFromEnv);

      const logger = createLogger(plan.serviceName);
      logger.info({ secrets: secretResolutionSummary(secrets) }, "resolved secrets");

      const server = new Server<TConfig>({
        config: plan.config,
        serviceName: plan.serviceName,
        secrets: stringValuesOf(secrets.environment),
        logger,
        observability,
        shutdownDeadlineMs: plan.shutdownDeadlineMs,
        exit,
      });

      // Hand the fatal handlers their logger: the same events, now structured
      // and correlated, instead of a raw stderr line with no trace context.
      bootFatal();
      server.disposeFatal = installFatalHandlers({
        service: plan.serviceName,
        log: logger,
        exit,
      });
      if (options.signals !== false) {
        server.disposeSignals = server.graceful.installSignalHandlers();
      }
      return server;
    } catch (error) {
      bootFatal();
      throw error;
    }
  }

  readonly config: TConfig;
  readonly serviceName: string;
  /** Every secret this process resolved, as its members are built from (ADR-132). */
  readonly secrets: Readonly<Record<string, string>>;
  readonly logger: Logger;
  readonly observability: ProcessObservabilityOptions;
  /** Everything the process opened, closed as one after the components stop. */
  readonly resources = new ResourceScope();
  /** The one teardown. `withGraceful` threads this into transports and eventing. */
  readonly graceful: GracefulShutdown;

  private readonly components: ServerComponent[] = [];
  private disposeFatal: (() => void) | undefined;
  private disposeSignals: (() => void) | undefined;
  private listening: Promise<void> | undefined;
  private closing: Promise<void> | undefined;
  private sealed = false;

  private constructor(options: {
    config: TConfig;
    serviceName: string;
    secrets: Readonly<Record<string, string>>;
    logger: Logger;
    observability: ProcessObservabilityOptions;
    shutdownDeadlineMs: number | undefined;
    exit: (code: number) => never;
  }) {
    this.config = options.config;
    this.serviceName = options.serviceName;
    this.secrets = options.secrets;
    this.logger = options.logger;
    this.observability = options.observability;
    this.graceful = GracefulShutdown.create({
      logger: options.logger,
      ...(options.shutdownDeadlineMs === undefined
        ? {}
        : { deadlineMs: options.shutdownDeadlineMs }),
      exit: options.exit,
      terminating: true,
    });
  }

  /**
   * Mounts one component. Called after the application is composed, so the
   * server hosts a built thing rather than constructing one.
   */
  host(component: ServerComponent): this {
    if (this.sealed) {
      throw new Error(`${this.serviceName} cannot host "${component.name}" after it has started.`);
    }
    this.components.push(component);
    return this;
  }

  /**
   * Starts every hosted component in order and registers the teardown in
   * reverse. Idempotent: a second call returns the first one's promise.
   */
  listen(): Promise<void> {
    this.listening ??= this.startComponents();
    return this.listening;
  }

  private async startComponents(): Promise<void> {
    this.sealed = true;
    const started: ServerComponent[] = [];
    try {
      for (const component of this.components) {
        await component.start?.();
        started.push(component);
      }
    } catch (error) {
      // Only what actually started is torn down; a component that threw during
      // start never took ownership of anything to release.
      await this.stopStarted(started);
      await this.resources.close();
      throw error;
    }

    for (const component of [...this.components].reverse()) {
      this.graceful.phase({
        name: component.name,
        run: () => component.stop(),
        ...(component.drain === true ? { drainPhase: true } : {}),
        ...(component.timeoutMs === undefined ? {} : { timeoutMs: component.timeoutMs }),
      });
    }
    this.graceful.phase({
      name: `${this.serviceName} resources`,
      run: () => this.resources.close(),
    });
  }

  private async stopStarted(started: readonly ServerComponent[]): Promise<void> {
    for (const component of [...started].reverse()) {
      try {
        await component.stop();
      } catch (error) {
        this.logger.error({ error, component: component.name }, "component failed to stop");
      }
    }
  }

  /** Runs the teardown once, whoever asked. Signals call the same path. */
  close(): Promise<void> {
    this.closing ??= Promise.resolve()
      .then(() => this.graceful.run())
      .then(() => void 0)
      .finally(() => {
        this.disposeSignals?.();
        this.disposeFatal?.();
      });
    return this.closing;
  }
}

/**
 * The two events that end a Node process. Before the logger exists they are
 * written raw to stderr; afterwards through the logger, so they carry the
 * service, the trace context and the redaction every other line does.
 */
function installFatalHandlers(options: {
  service: string;
  log: Logger | undefined;
  exit: (code: number) => never;
}): () => void {
  const report = (event: string, error: unknown): void => {
    try {
      if (options.log) options.log.error({ error, event }, `${options.service}: ${event}`);
      else process.stderr.write(fatalLine(options.service, event, error));
    } catch {
      process.stderr.write(fatalLine(options.service, event, error));
    }
  };
  const uncaughtException = (error: unknown) => {
    report("uncaught exception", error);
    options.exit(1);
  };
  const unhandledRejection = (reason: unknown) => {
    report("unhandled rejection", reason);
    options.exit(1);
  };
  process.on("uncaughtException", uncaughtException);
  process.on("unhandledRejection", unhandledRejection);
  return () => {
    process.off("uncaughtException", uncaughtException);
    process.off("unhandledRejection", unhandledRejection);
  };
}

function fatalLine(service: string, event: string, error: unknown): string {
  return `${JSON.stringify({
    level: "fatal",
    time: new Date().toISOString(),
    service,
    msg: event,
    error: error instanceof Error ? { message: error.message, stack: error.stack } : String(error),
  })}\n`;
}

/**
 * The resolved environment narrowed to the string values a member is built
 * from. Anything else was never a secret this process can hand on.
 */
function stringValuesOf(
  environment: Readonly<Record<string, unknown>>,
): Readonly<Record<string, string>> {
  const values: Record<string, string> = {};
  for (const [key, value] of Object.entries(environment)) {
    if (typeof value === "string") values[key] = value;
  }
  return values;
}
