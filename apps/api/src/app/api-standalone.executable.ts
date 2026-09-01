import process from "node:process";
import { ApiBootFailurePort, startApiExecutable } from "../api.executable";
import type { ApiRuntimeBootstrap } from "../api.main";
import type { ApiShutdownSignal, ApiSignalHost } from "../api.signal-handlers";
import { ApiStandaloneComposition, type ApiProductAdapters } from "./api-standalone.composition";

/**
 * Everything the standalone executable subscribes to on the process it runs
 * in: the two ways a crash arrives, and the two ways an orchestrator asks it
 * to stop.
 */
export type ApiExecutableHostEvent = "uncaughtException" | "unhandledRejection" | ApiShutdownSignal;

/**
 * The Node process surface the standalone executable needs, injectable for
 * tests.
 *
 * It is the executable's ONE seam onto the process. Signal subscription used
 * to reach past it for the real `process`, which left the executable owning
 * the exit status of a crash but not of a SIGTERM, and left a host embedding
 * it with handlers it could not remove.
 */
export type ApiExecutableHost = Readonly<{
  env: Readonly<Record<string, unknown>>;
  on(event: ApiExecutableHostEvent, listener: (value: unknown) => void): void;
  off(event: ApiExecutableHostEvent, listener: (value: unknown) => void): void;
  exit(code: number): void;
  write(line: string): void;
}>;

export type ApiStandaloneExecutableOptions = Readonly<{
  host?: ApiExecutableHost;
  /** A host that already owns the product service graph supplies it here. */
  products?: ApiProductAdapters;
}>;

/**
 * The physical API executable: one table of what this process is made of.
 *
 *   source      the process's environment, read once and validated once
 *   composition {@link ApiStandaloneComposition} — the production graph, which
 *               composes its own database, cipher, AuthZ, tenancy, agents and
 *               Auth, and names whatever it could not build
 *   failures    a boot failure written where an operator reads it
 *   signals     SIGTERM and SIGINT, and the exit status each one produces
 *
 * Everything below the table belongs to something else: configuration
 * parsing, signal policy and the shutdown deadline are ApiRuntimeBootstrap's,
 * which startApiExecutable drives, and every product decision is the
 * composition's.
 *
 * It imports no legacy application graph, so it cannot start a partial second
 * copy of the platform process.
 */
export async function startStandaloneApi(
  options: ApiStandaloneExecutableOptions = {},
): Promise<ApiRuntimeBootstrap> {
  const host = options.host ?? nodeApiExecutableHost();
  installFatalHandlers(host);
  return startApiExecutable({
    source: host.env,
    composition: ApiStandaloneComposition.create(
      options.products ? { products: options.products } : {},
    ),
    failures: WrittenApiBootFailure.create(host),
    signals: { host: signalHostOf(host), exit: (code) => host.exit(code) },
  });
}

/**
 * Boot failures reach the process's error stream as one legible report.
 *
 * A configuration error is the whole reason the process refuses to start, so
 * the operator must be able to read what was wrong without decoding a raw
 * unhandled rejection.
 */
export class WrittenApiBootFailure extends ApiBootFailurePort {
  static create(host: Pick<ApiExecutableHost, "write">): WrittenApiBootFailure {
    return new WrittenApiBootFailure(host);
  }

  private constructor(private readonly host: Pick<ApiExecutableHost, "write">) {
    super();
  }

  report(error: unknown): void {
    this.host.write(`[langwatch:api] fatal boot failure: ${describeApiFailure(error)}\n`);
  }
}

/** Renders a failure with its message first, so a truncated log still names it. */
export function describeApiFailure(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  return error.stack ? `${error.message}\n${error.stack}` : error.message;
}

function installFatalHandlers(host: ApiExecutableHost): void {
  host.on("uncaughtException", (error) => {
    host.write(`[langwatch:api] uncaught exception: ${describeApiFailure(error)}\n`);
    host.exit(1);
  });
  host.on("unhandledRejection", (reason) => {
    host.write(`[langwatch:api] unhandled rejection: ${describeApiFailure(reason)}\n`);
    host.exit(1);
  });
}

/**
 * The shutdown-signal projection of the executable's host.
 *
 * A projection rather than the host itself, so the signal boundary keeps its
 * own two-method contract and cannot subscribe to a crash event by accident.
 */
function signalHostOf(host: ApiExecutableHost): ApiSignalHost {
  return {
    on: (signal, listener) => {
      host.on(signal, listener);
    },
    off: (signal, listener) => {
      host.off(signal, listener);
    },
  };
}

function nodeApiExecutableHost(): ApiExecutableHost {
  return {
    env: process.env,
    on: (event, listener) => {
      process.on(event, listener);
    },
    off: (event, listener) => {
      process.off(event, listener);
    },
    exit: (code) => process.exit(code),
    write: (line) => {
      process.stderr.write(line);
    },
  };
}
