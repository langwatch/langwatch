/**
 * The telemetry seam -- the reason daemon mode exists, not a side benefit.
 * A short-lived CLI can't flush an exporter without losing spans; a daemon
 * holds one long-lived exporter instead, injected via `createDaemonServer`.
 */

export interface DaemonRequestStartedEvent {
  requestId: string;
  /** User-level args, i.e. `["trace", "search", "--format", "json"]`. */
  args: string[];
  cwd: string;
}

export interface DaemonRequestProgressEvent {
  requestId: string;
  stream: "stdout" | "stderr";
  bytes: number;
}

export interface DaemonRequestFinishedEvent {
  requestId: string;
  exitCode: number;
  durationMs: number;
  /** Set when the command threw instead of exiting cleanly. */
  error?: unknown;
  /** Set when the client cancelled (Ctrl-C) before the command finished. */
  cancelled?: boolean;
}

export interface DaemonLifecycleEvent {
  pid: number;
  socketPath: string;
  cliVersion: string;
}

export interface DaemonTelemetry {
  daemonStarted(event: DaemonLifecycleEvent): void;
  daemonStopping(
    event: DaemonLifecycleEvent & { reason: "idle" | "stop-requested" | "signal" },
  ): void;

  requestStarted(event: DaemonRequestStartedEvent): void;
  /**
   * Fires as output is produced, before the command finishes. This is the hook
   * a live UI subscribes to; there is no equivalent in a per-invocation CLI.
   */
  requestProgress(event: DaemonRequestProgressEvent): void;
  requestFinished(event: DaemonRequestFinishedEvent): void;

  /** Flush and tear down. Awaited on every graceful daemon exit path. */
  shutdown(): Promise<void>;
}

export const noopTelemetry: DaemonTelemetry = {
  daemonStarted: () => undefined,
  daemonStopping: () => undefined,
  requestStarted: () => undefined,
  requestProgress: () => undefined,
  requestFinished: () => undefined,
  shutdown: () => Promise.resolve(),
};
