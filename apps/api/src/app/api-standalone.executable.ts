import process from "node:process";
import { ApiBootFailurePort, startApiExecutable } from "../api.executable";
import type { ApiRuntimeBootstrap } from "../api.main";
import { ApiStandaloneComposition, type ApiProductAdapters } from "./api-standalone.composition";

/** The Node process surface the standalone executable needs, injectable for tests. */
export type ApiExecutableHost = Readonly<{
  env: Readonly<Record<string, unknown>>;
  on(event: "uncaughtException" | "unhandledRejection", listener: (value: unknown) => void): void;
  exit(code: number): void;
  write(line: string): void;
}>;

export type ApiStandaloneExecutableOptions = Readonly<{
  host?: ApiExecutableHost;
  /** A host that already owns the product service graph supplies it here. */
  products?: ApiProductAdapters;
}>;

/**
 * The physical API executable.
 *
 * It selects the configuration source, hands one complete composition to the
 * boot boundary, and owns the two concerns nothing below it can own: how a
 * fatal boot failure is reported, and what exit status a crash produces.
 * Configuration parsing, signal policy and the shutdown deadline belong to
 * ApiRuntimeBootstrap, which startApiExecutable drives.
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

function nodeApiExecutableHost(): ApiExecutableHost {
  return {
    env: process.env,
    on: (event, listener) => {
      process.on(event, listener);
    },
    exit: (code) => process.exit(code),
    write: (line) => {
      process.stderr.write(line);
    },
  };
}
