/**
 * What to do with the vendor client's own log records.
 *
 * `@clickhouse/client` logs an error for every failed HTTP attempt and cannot
 * know whether the caller then retried and succeeded, so those records carry no
 * verdict. Routed to our error level they made recovered work indistinguishable
 * from real failure and were roughly half of one service's error volume.
 *
 * Two rules come out of that, and they are the whole of this module:
 *
 *  1. Drop the vendor's `error`. A call under the retry wrapper is reported by
 *     the wrapper, which knows the outcome, and an unwrapped call throws, which
 *     surfaces at the request boundary with a stack. The exception is the
 *     signal; the vendor record is an echo with the verdict missing.
 *
 *  2. Never attach the cause under a field named `error`. Loki derives
 *     `detected_level` from the presence of that field, so an `error` key
 *     promotes a record to error regardless of the level chosen here - which is
 *     how successful retries came to be counted as failures.
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
 * Decide how a vendor record should be emitted, or `null` to drop it.
 *
 * Pure, so the policy is testable without a logger and identical in every
 * process that adopts it.
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
 * The class `@clickhouse/client` is handed as its `log.LoggerClass`.
 *
 * Without one the driver writes its own console lines —
 * `[2026-09-03T10:58:28.487Z][ERROR][@clickhouse/client][Connection] ...` — a
 * shape nothing else in the process prints, in a lane whose every other line
 * is a time, a level and a scope. The policy above already decided what a
 * vendor record means; this is what finally routes one through the process's
 * own logger so it looks like everything else that process says.
 *
 * The driver asks for a zero-argument constructor, which is why this is a
 * factory: the sink is closed over rather than passed in, and this package
 * still names no logger of its own.
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
