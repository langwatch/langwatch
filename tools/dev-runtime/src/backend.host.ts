import type { ApiExecutableHost } from "@langwatch/platform-api";
import type { WorkerExecutableProcessHost } from "@langwatch/worker";

/**
 * The one process seam both hosted applications share: everything the API
 * executable needs of a host, and everything the worker executable needs of
 * one, in a single object.
 */
export type BackendEmbeddedHost = ApiExecutableHost & WorkerExecutableProcessHost;

/** Where a hosted application's own output goes, and what it names it. */
export type BackendHostOptions = {
  env: Readonly<Record<string, unknown>>;
  write: (line: string) => void;
  /** Called when a hosted application decides the process must end. */
  fail: (code: number) => void;
};

/**
 * The process seam each hosted application gets inside the backend process.
 *
 * Both executables take a host precisely so something can embed them, and
 * embedding is the whole point here: each one would otherwise install its own
 * SIGTERM handler, its own uncaught-exception handler and its own
 * `process.exit`, and the first of the two to hear a signal would end the
 * process while the other was still draining. So neither is given the real
 * process: signal subscription is accepted and dropped, and an application
 * asking to exit reports a fatal to the one owner instead of taking the
 * process down itself.
 *
 * Nothing is silently swallowed. `fail` is what the backend process installs
 * its single shutdown on, and it is the only path from a hosted application's
 * `exit(code)` to the process's exit status.
 */
export function embeddedBackendHost(options: BackendHostOptions): BackendEmbeddedHost {
  const ignore = (): void => void 0;
  return {
    env: options.env,
    on: ignore,
    off: ignore,
    onUncaughtException: ignore,
    offUncaughtException: ignore,
    onUnhandledRejection: ignore,
    offUnhandledRejection: ignore,
    exit: (code: number) => options.fail(code),
    write: options.write,
  };
}
