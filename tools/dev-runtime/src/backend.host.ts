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
 * Hosted apps cannot own signals or exit because the shared process must drain both.
 * Signal subscriptions are ignored; exit reports through the process owner's `fail`.
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
