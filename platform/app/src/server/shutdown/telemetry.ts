/**
 * Telemetry flushes that run as the last phase of a graceful shutdown.
 *
 * Deliberately dependency-free: instrumentation.node.ts registers into this
 * before the app graph evaluates, and anything it imports is loaded on the
 * boot path of every process.
 *
 * Why a registry rather than each provider owning a signal handler: Node runs
 * EVERY listener registered for a signal, so a provider that handles SIGTERM
 * itself is racing the shutdown rather than participating in it — and a
 * provider that then calls process.exit() does not race it, it wins.
 *
 * Two of those existed. The metrics MeterProvider registered SIGTERM/SIGINT
 * for a best-effort flush, its own comment conceding it was racing the exit.
 * Worse, the `langwatch` SDK's setupObservability() registers SIGTERM/SIGINT
 * by default and calls `process.exit(0)` once its OTel flush resolves — a
 * second or two into a shutdown, killing a queue drain entitled to 25s. The
 * SDK is now constructed with `disableAutoShutdown: true` and its shutdown
 * registered here, so telemetry still flushes but on our schedule and never
 * as the thing that ends the process.
 *
 * These run LAST, after the work is drained and the connections are closed,
 * so the spans and logs describing the shutdown are themselves exported.
 */

export interface TelemetryFlush {
  name: string;
  run: () => Promise<void>;
}

const flushes: TelemetryFlush[] = [];

/**
 * Registers a telemetry provider's shutdown/flush.
 *
 * Idempotent per name: instrumentation is imported once per process, but a
 * double registration would double the flush and, more to the point, hide
 * which module actually owns it.
 */
export function registerTelemetryFlush(flush: TelemetryFlush): void {
  if (flushes.some((f) => f.name === flush.name)) return;
  flushes.push(flush);
}

export function telemetryFlushes(): readonly TelemetryFlush[] {
  return flushes;
}

/** Test-only: the registry is process-global, so a test that registers must reset. */
export function clearTelemetryFlushes(): void {
  flushes.length = 0;
}
