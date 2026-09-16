/**
 * Two rules for the vendor client's log records: drop its `error` (the retry
 * wrapper or an unwrapped throw already carries the real verdict); never key
 * the cause `error` (Loki promotes on that key, once miscounting retries as failures).
 */

export type VendorLogLevel = "trace" | "debug" | "info" | "warn" | "error";

/** The shape `@clickhouse/client` hands its logger, narrowed to what is used. */
export interface VendorLogRecord {
  module?: string | undefined;
  message: string;
  args?: Record<string, unknown> | undefined;
  err?: Error | undefined;
}

/** Where the cause is attached. Deliberately not `error`; see rule 2 above. */
export const VENDOR_CAUSE_FIELD = "clientError";

export type EmittedLevel = "debug" | "info" | "warn";

export interface VendorLogDecision {
  level: EmittedLevel;
  message: string;
  fields: Record<string, unknown>;
}

export interface DecideVendorLogInput {
  level: VendorLogLevel;
  record: VendorLogRecord;
}

/**
 * Decides how a vendor record is emitted, or `null` to drop it. Pure, so
 * the policy is testable without a logger and identical in every process
 * that adopts it.
 */
export function decideVendorLog({ level, record }: DecideVendorLogInput): VendorLogDecision | null {
  if (level === "error") return null;

  const fields: Record<string, unknown> = { ...(record.args ?? {}) };
  // The vendor owns `args`, so it could carry an `error` key of its own and
  // silently defeat the rule this module exists for.
  delete fields.error;
  if (record.module !== undefined) fields.module = record.module;
  if (record.err !== undefined) fields[VENDOR_CAUSE_FIELD] = record.err;

  return {
    level: level === "trace" ? "debug" : level,
    message: record.message,
    fields,
  };
}

/** The subset of a structured logger this policy needs. */
export interface VendorLogSink {
  debug: (fields: Record<string, unknown>, message: string) => void;
  info: (fields: Record<string, unknown>, message: string) => void;
  warn: (fields: Record<string, unknown>, message: string) => void;
}

export interface EmitVendorLogInput {
  sink: VendorLogSink;
  level: VendorLogLevel;
  record: VendorLogRecord;
}

/**
 * Apply {@link decideVendorLog} to a sink. Returns whether anything was
 * emitted, which is what lets a caller assert the drop without reaching into
 * the sink.
 */
export function emitVendorLog({ sink, level, record }: EmitVendorLogInput): boolean {
  const decision = decideVendorLog({ level, record });
  if (decision === null) return false;
  sink[decision.level](decision.fields, decision.message);
  return true;
}

/** The vendor's own logger interface, as `@clickhouse/client` calls it. */
export interface VendorLogger {
  trace(record: VendorLogRecord): void;
  debug(record: VendorLogRecord): void;
  info(record: VendorLogRecord): void;
  warn(record: VendorLogRecord): void;
  error(record: VendorLogRecord): void;
}

/**
 * The class `@clickhouse/client` is handed as its `log.LoggerClass`, so its
 * records route through the process's own structured logger instead of raw
 * console lines. A factory because the driver wants a zero-arg constructor.
 */
export function vendorLoggerClassFor(sink: VendorLogSink): new () => VendorLogger {
  return class ClickHouseVendorLogger implements VendorLogger {
    trace(record: VendorLogRecord): void {
      emitVendorLog({ sink, level: "trace", record });
    }
    debug(record: VendorLogRecord): void {
      emitVendorLog({ sink, level: "debug", record });
    }
    info(record: VendorLogRecord): void {
      emitVendorLog({ sink, level: "info", record });
    }
    warn(record: VendorLogRecord): void {
      emitVendorLog({ sink, level: "warn", record });
    }
    error(record: VendorLogRecord): void {
      emitVendorLog({ sink, level: "error", record });
    }
  };
}
