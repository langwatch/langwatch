import http, { type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import process from "node:process";
import type { Duplex } from "node:stream";

import { ResourceScope } from "@langwatch/kernel";

import { GracefulShutdown } from "./graceful-shutdown.ts";
import { hostedRuntime } from "./hosted-runtime.ts";

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
  /**
   * The built-in health door's port. Absent binds an ephemeral port, so the
   * door is on for every process regardless of whether it configured one.
   */
  healthPort?: number;
}>;

/**
 * A route a component contributes to the server's own built-in health door,
 * rather than a listener of its own. `/healthz` is reserved; everything else
 * is dispatched to the route whose `path` matches exactly.
 */
export type HealthRoute = Readonly<{
  path: string;
  handle: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>;
}>;

/** The one router every upgrade on the door is handed to; closed before the door itself. */
export type UpgradeDoor = Readonly<{
  upgrade: (request: IncomingMessage, socket: Duplex, head: Buffer) => void;
  close: () => Promise<void>;
}>;

/** Whatever `.with()` accepts: a lifecycle component, a door route, or its upgrade router. */
export type ServerContribution = ServerComponent | HealthRoute | UpgradeDoor;

function isHealthRoute(contribution: ServerContribution): contribution is HealthRoute {
  return "path" in contribution && "handle" in contribution;
}

function isUpgradeDoor(contribution: ServerContribution): contribution is UpgradeDoor {
  return "upgrade" in contribution;
}

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

/** Owns process signals, listeners and teardown order. */
export class Server {
  static create(options: ServerOptions): Server {
    const exit = options.exit ?? (process.exit.bind(process) as (code: number) => never);
    const server = new Server({
      name: options.name,
      logger: options.logger,
      shutdownDeadlineMs: options.shutdownDeadlineMs,
      exit,
    });
    // Hosted first, so it stops LAST: the health door outlives every drain
    // phase, and a probe during shutdown still sees the process as alive.
    server.with(server.createHealthComponent(options.healthPort));
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
  private readonly healthRoutes = new Map<string, HealthRoute>();
  /** The ONE handler the application composed. Absent until `serve`. */
  private served: ApplicationHandler | undefined;
  private healthListener: http.Server | undefined;
  private upgrades: UpgradeDoor | undefined;
  private draining = false;
  private disposeFatal: (() => void) | undefined;
  private disposeSignals: (() => void) | undefined;
  private listening: Promise<void> | undefined;
  private closing: Promise<void> | undefined;
  private sealed = false;

  readonly name: string;
  private readonly logger: ServerLogger;

  protected constructor({
    name,
    logger,
    shutdownDeadlineMs,
    exit,
  }: {
    name: string;
    logger: ServerLogger;
    shutdownDeadlineMs: number | undefined;
    exit: (code: number) => never;
  }) {
    this.name = name;
    this.logger = logger;
    this.graceful = GracefulShutdown.create({
      logger,
      ...(shutdownDeadlineMs === undefined ? {} : { deadlineMs: shutdownDeadlineMs }),
      exit,
      terminating: true,
    });
  }

  /**
   * The one word for mounting something on this server: a lifecycle
   * component, or a route on the built-in health door. Packages own the
   * vocabulary — this only tells the two contribution shapes apart.
   */
  with(contribution: ServerContribution): this {
    if (isHealthRoute(contribution)) {
      this.healthRoutes.set(contribution.path, contribution);
      return this;
    }
    if (isUpgradeDoor(contribution)) {
      if (this.upgrades) throw new Error(`${this.name} already has an upgrade router.`);
      this.upgrades = contribution;
      return this;
    }
    if (this.sealed) {
      throw new Error(`${this.name} cannot host "${contribution.name}" after it has started.`);
    }
    this.components.push(contribution);
    return this;
  }

  /** The health door's bound address, once started. `null` before or after. */
  get healthAddress(): AddressInfo | string | null {
    return this.healthListener?.address() ?? null;
  }

  private createHealthComponent(port: number | undefined): ServerComponent {
    return {
      name: `${this.name} health`,
      start: async () => {
        const listener = http.createServer((request, response) =>
          this.handleHealthRequest(request, response),
        );
        listener.on("upgrade", (request: IncomingMessage, socket: Duplex, head: Buffer) =>
          this.handleUpgrade(request, socket, head),
        );
        await bindHttpServer(listener, port ?? 0);
        this.healthListener = listener;
      },
      stop: async () => {
        const active = this.healthListener;
        this.healthListener = undefined;
        if (active === undefined) return;
        await this.upgrades?.close();
        await closeHttpServer(active);
      },
    };
  }

  private handleHealthRequest(request: IncomingMessage, response: ServerResponse): void {
    if (request.url === "/healthz") {
      response.writeHead(200, { "Content-Type": "text/plain" }).end("ok");
      return;
    }

    const route = request.url === undefined ? undefined : this.healthRoutes.get(request.url);
    if (route !== undefined) {
      void this.answer(route.path, () => route.handle(request, response), response);
      return;
    }

    // A draining process still answers its probes — that is why the health
    // door stops last — but it takes no new work, and says so by name.
    if (this.draining) {
      response
        .writeHead(503, { "Content-Type": "text/plain" })
        .end(`${this.name} is shutting down`);
      return;
    }

    const application = this.served;
    if (application === undefined) {
      if (!response.headersSent) response.writeHead(404).end();
      return;
    }

    void this.answer("application", () => application(request, response), response);
  }

  private handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void {
    const upgrades = this.upgrades;
    if (this.draining || upgrades === undefined) {
      const status = this.draining ? "503 Service Unavailable" : "404 Not Found";
      socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`);
      socket.destroy();
      return;
    }

    try {
      upgrades.upgrade(request, socket, head);
    } catch (error) {
      this.logger.error({ error, handler: "upgrade" }, `${this.name}: upgrade handler failed`);
      socket.destroy();
    }
  }

  /**
   * One contribution's turn at the request. A failure is the door's to report
   * and to answer for, so a handler that throws cannot leave a socket open.
   */
  private async answer(
    name: string,
    run: () => void | boolean | Promise<void | boolean>,
    response: ServerResponse,
  ): Promise<boolean> {
    try {
      return (await run()) !== false;
    } catch (error) {
      this.logger.error({ error, handler: name }, `${this.name}: door handler failed`);
      if (!response.headersSent) response.writeHead(500).end();
      return true;
    }
  }

  /** Hosts the composed application behind health routes on the same listener. */
  serve(application: ServedApplication): Promise<void> {
    this.with(hostedRuntime({ name: `${application.name} runtime`, runtime: application }));
    if (!isApplicationHandler(application.handler)) {
      throw new Error(
        `"${application.name}" was served without composing a handler. An application whose ` +
          `chain exposes nothing has nothing for this server to answer requests with.`,
      );
    }
    this.served = application.handler;

    return this.listen();
  }

  /**
   * The same binding for a process with no HTTP surface of its own: the
   * application's background work is hosted drain-first, so it finishes what
   * it took before anything it calls into is closed under it.
   */
  run(application: ServedApplication): Promise<void> {
    this.with(
      hostedRuntime({ name: `${application.name} runtime`, runtime: application, drain: true }),
    );

    return this.listen();
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

    // Before every teardown phase, so a signal makes the door refuse new work
    // by name while the graph behind it is still whole.
    this.graceful.phase({
      name: `${this.name} door`,
      run: () => {
        this.draining = true;
      },
    });
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
    this.draining = true;
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

/** The one thing a served application answers requests with. */
export type ApplicationHandler = (
  request: IncomingMessage,
  response: ServerResponse,
) => void | Promise<void>;

/**
 * A booted application, as the server that hosts it reads one. Transports are
 * erased here on purpose: this package knows no protocol, and what turned a
 * declaration into something that answers a request was decided elsewhere.
 */
export type ServedApplication = Readonly<{
  name: string;
  start: () => void | Promise<void>;
  stop: () => void | Promise<void>;
  /** Composed by the chain's own `expose`, once every declaration mounted. */
  handler?: unknown;
}>;

function isApplicationHandler(handler: unknown): handler is ApplicationHandler {
  return typeof handler === "function";
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

/**
 * How long a successor waits for its predecessor's socket. A restart is a
 * handover: the outgoing process drains in-flight work before it lets go.
 */
const BIND_HANDOVER_MS = 10_000;
const BIND_RETRY_MS = 250;

function isAddressInUse(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === "EADDRINUSE";
}

function listenOnce(listener: http.Server, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error): void => reject(error);
    listener.once("error", onError);
    listener.listen(port, () => {
      listener.off("error", onError);
      resolve();
    });
  });
}

/**
 * Two different failures share `EADDRINUSE`: another program owns the port,
 * and our predecessor has not let go yet — only the first is worth dying for.
 * Spec: specs/setup/boot-sequence.feature
 */
export async function bindHttpServer(
  listener: http.Server,
  port: number,
  handoverMs: number = BIND_HANDOVER_MS,
): Promise<void> {
  // Monotonic: a deadline must not move when the wall clock does.
  const deadline = performance.now() + handoverMs;
  for (;;) {
    try {
      await listenOnce(listener, port);
      return;
    } catch (error) {
      if (!isAddressInUse(error) || performance.now() >= deadline) throw error;
      await new Promise((resume) => setTimeout(resume, BIND_RETRY_MS));
    }
  }
}

function closeHttpServer(listener: http.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    listener.close((error) => {
      if (error !== undefined) {
        reject(error);
        return;
      }
      resolve();
    });
    listener.closeAllConnections();
  });
}
