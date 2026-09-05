/**
 * Telemetry flushes that run as the last phase of a graceful shutdown. A
 * provider with its own signal handler races the shutdown, and one calling
 * process.exit() when its flush resolves wins that race.
 */

export interface TelemetryFlush {
  name: string;
  run: () => Promise<void>;
}

const flushes: TelemetryFlush[] = [];

/**
 * Registers a telemetry provider's flush. Idempotent per name: a double
 * registration doubles the flush and hides which module owns it.
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
