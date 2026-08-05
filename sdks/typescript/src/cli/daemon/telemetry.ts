/**
 * The telemetry seam.
 *
 * This is the reason daemon mode exists, not a side benefit of it.
 *
 * A 200ms CLI process cannot emit useful telemetry: it has to construct a
 * TracerProvider, an exporter and an HTTP connection, then SYNCHRONOUSLY flush
 * them before exit. Spans get dropped when the flush loses the race with
 * process teardown, and *mid-flight* progress is structurally impossible to
 * emit — there is no "mid-flight" in a process that barely exists.
 *
 * A daemon lives for minutes. It can hold one long-lived TracerProvider with a
 * BatchSpanProcessor and one warm OTLP connection, and it can emit events WHILE
 * a command runs — which is what the Langy UI needs in order to show live
 * progress for a command an agent is executing right now.
 *
 * THIS CHANGE DELIBERATELY SHIPS NO OTEL EMISSION. It ships the seam:
 *
 *   - `DaemonTelemetry` is the interface a real exporter implements.
 *   - `noopTelemetry` is what the daemon uses today; it does nothing.
 *   - `createDaemonServer({ telemetry })` takes it by injection, so the
 *     exporter can be attached without touching the server, and so tests can
 *     assert on the events without a collector.
 *
 * TO ATTACH THE PERSISTENT OTLP EXPORTER LATER:
 *
 *   1. Implement `DaemonTelemetry` over a `NodeTracerProvider` +
 *      `BatchSpanProcessor` + `OTLPTraceExporter` built ONCE in
 *      `daemonStarted` (the SDK already depends on all three).
 *   2. `requestStarted` opens a span; `requestProgress` adds span events (this
 *      is the live-progress hook — it fires as each chunk of output is
 *      produced, not at the end); `requestFinished` closes the span with the
 *      exit code.
 *   3. `shutdown` is the ONLY place a flush is needed, and it is called on the
 *      idle-timeout path and on `daemon stop` — where, unlike in a short-lived
 *      CLI process, there is time to actually complete it.
 *
 * Nothing else in the daemon needs to change to light that up.
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
  daemonStopping(event: DaemonLifecycleEvent & { reason: "idle" | "stop-requested" | "signal" }): void;

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
