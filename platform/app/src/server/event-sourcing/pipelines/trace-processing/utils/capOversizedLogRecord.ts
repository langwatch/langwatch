/**
 * capOversizedLogRecord — bounds the byte-size of a normalized log record's
 * `body` and attribute values at ingestion, before the LogRecordReceivedEvent
 * enters the event-sourcing fold.
 *
 * Why this exists
 * ---------------
 * This is the log-record analog of `capOversizedAttributes` (which guards the
 * span path). Claude Code's content-unlock flags — `OTEL_LOG_RAW_API_BODIES`
 * (=> `claude_code.api_request_body` / `api_response_body` events carrying the
 * full Messages API request+response JSON) and `OTEL_LOG_TOOL_DETAILS` — emit
 * the assistant output text + tool I/O on OTLP LOG records, not spans. Claude
 * caps each inline body at ~60KB, but `=file:<dir>` mode and future versions
 * can exceed that, and a trace folds every log record into a per-trace fold
 * STATE in Redis via a read-modify-write per event. A multi-megabyte body on
 * that path bloats the fold state, saturates the single-threaded Redis command
 * loop, and collapses folding throughput — the same failure mode that took
 * down ingestion in the fat-payload CH-merge incident. The span path is
 * already protected; the log path was not.
 *
 * Behaviour
 * ---------
 * - Replaces `body` and any attribute / resourceAttribute value whose UTF-8
 *   byte size exceeds the (generous, shared-with-spans) threshold with the
 *   kept head plus a short marker describing how much was cut.
 * - The threshold (256KB) sits far above Claude's 60KB inline body cap, so
 *   normal collect-everything traffic is byte-for-byte untouched; only the
 *   pathological multi-MB record is bounded.
 * - Mutates in place, never throws (a malformed value is left as-is rather than
 *   blocking ingestion), and returns the number of fields capped for logging.
 */
import { DEFAULT_MAX_ATTRIBUTE_VALUE_BYTES } from "./capOversizedAttributes";

export interface CappableLogRecord {
  body: string;
  attributes: Record<string, string>;
  resourceAttributes: Record<string, string>;
}

/** UTF-8 byte length without allocating a Buffer copy. */
function utf8ByteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

/**
 * Caps a single string to `maxBytes`. Returns the original when it already
 * fits, otherwise the kept head (on a UTF-8 byte budget) plus a marker naming
 * the original size (and an optional `label` so the cut is self-describing in
 * the stored value — telemetry without a logger dependency in the hot path).
 * The marker itself is counted against the budget so the result never exceeds
 * `maxBytes`.
 */
function capStringWithFlag(
  value: string,
  maxBytes: number,
  label?: string,
): { value: string; capped: boolean } {
  const byteSize = utf8ByteLength(value);
  if (byteSize <= maxBytes) return { value, capped: false };
  const labelPart = label ? ` ${label}` : "";
  const marker = `…[langwatch: truncated${labelPart}, ${byteSize} bytes total]`;
  const budget = Math.max(0, maxBytes - utf8ByteLength(marker));
  // subarray on a UTF-8 buffer can split a multibyte sequence; toString
  // tolerates it (yields a single replacement char), which is fine for a
  // truncation tail and keeps us strictly under budget.
  const head = Buffer.from(value, "utf8").subarray(0, budget).toString("utf8");
  return { value: head + marker, capped: true };
}

/**
 * Public single-string cap. Use at any content lift site (e.g. the assistant
 * output text pulled from `api_response_body`) so a pathological payload is
 * bounded before it reaches the fold / ComputedOutput. `label` is embedded in
 * the truncation marker so a cut is visible in the stored value.
 */
export function capPayloadString(
  value: string,
  maxBytes: number = DEFAULT_MAX_ATTRIBUTE_VALUE_BYTES,
  label?: string,
): string {
  return capStringWithFlag(value, maxBytes, label).value;
}

function capRecord(
  record: Record<string, string>,
  maxBytes: number,
): number {
  let count = 0;
  for (const key of Object.keys(record)) {
    const current = record[key];
    if (typeof current !== "string") continue;
    const result = capStringWithFlag(current, maxBytes, `attr:${key}`);
    if (result.capped) {
      record[key] = result.value;
      count++;
    }
  }
  return count;
}

/**
 * Caps an in-place log record's `body` + attribute + resourceAttribute values
 * over `maxBytes`. Returns the number of fields capped (for logging / tests).
 */
export function capOversizedLogRecord(
  log: CappableLogRecord,
  maxBytes: number = DEFAULT_MAX_ATTRIBUTE_VALUE_BYTES,
): number {
  let count = 0;
  try {
    if (typeof log.body === "string") {
      const body = capStringWithFlag(log.body, maxBytes, "log_body");
      if (body.capped) {
        log.body = body.value;
        count++;
      }
    }
    if (log.attributes) count += capRecord(log.attributes, maxBytes);
    if (log.resourceAttributes)
      count += capRecord(log.resourceAttributes, maxBytes);
  } catch {
    // Degraded, not broken: never block ingestion on a malformed value.
  }
  return count;
}
