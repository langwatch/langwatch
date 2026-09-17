import process from "node:process";

import { ResourceScope } from "@langwatch/kernel";

import { GracefulShutdown } from "./graceful-shutdown.ts";

/** What this package needs of a logger, so it depends on no logging implementation. */
export interface ServerLogger {
  info: (obj: object, msg: string) => void;
  error: (obj: object, msg: string) => void;
}

export type ServerOptions = Readonly<{
  /** Names the process in shutdown and fatal lines. */
  name: string;
  logger: ServerLogger;
  /** The watchdog ceiling for the whole teardown. Absent, there is no watchdog. */
  shutdownDeadlineMs?: number;
  /**
   * Whether this server owns SIGTERM/SIGINT and the fatal handlers. An embedded
   * server shares a process with another and must not race it to the exit.
   */
  ownsProcess?: boolean;
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
 * The process boundary: the signals that end it, the failures that kill it,
 * and the order the things it hosts are torn down in.
 *
 * It builds no telemetry and reads no config. A process resolves those itself
 * and hands this one a logger, so those concerns keep their own owners.
 */
export class Server {
  static create(options: ServerOptions): Server {
    const exit = options.exit ?? (process.exit.bind(process) as (code: number) => never);
    const server = new Server(options.name, options.logger, options.shutdownDeadlineMs, exit);
    if (options.ownsProcess !== false) {
      server.disposeFatal = installFatalHandlers({
        service: options.name,
        logger: options.logger,
        exit,
      });
      server.disposeSignals = server.graceful.installSignalHandlers();
    }
    return server;
  }

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

  private constructor(
    readonly name: string,
    private readonly logger: ServerLogger,
    shutdownDeadlineMs: number | undefined,
    exit: (code: number) => never,
  ) {
    this.graceful = GracefulShutdown.create({
      logger,
      ...(shutdownDeadlineMs === undefined ? {} : { deadlineMs: shutdownDeadlineMs }),
      exit,
      terminating: true,
    });
  }

  /**
   * Mounts one component. Called after the application is composed, so the
   * server hosts a built thing rather than constructing one.
   */
  host(component: ServerComponent): this {
    if (this.sealed) {
      throw new Error(`${this.name} cannot host "${component.name}" after it has started.`);
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
    this.graceful.phase({ name: `${this.name} resources`, run: () => this.resources.close() });
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
 * The two events that end a Node process, reported through the logger the
 * process already built rather than a raw stderr line with no trace context.
 */
function installFatalHandlers(options: {
  service: string;
  logger: ServerLogger;
  exit: (code: number) => never;
}): () => void {
  const report = (event: string, error: unknown): void => {
    try {
      options.logger.error({ error, event }, `${options.service}: ${event}`);
    } catch {
      process.stderr.write(
        `${JSON.stringify({ level: "fatal", service: options.service, msg: event })}\n`,
      );
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
