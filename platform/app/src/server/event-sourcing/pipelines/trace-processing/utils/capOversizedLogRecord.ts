/**
 * capPayloadString — bounds the UTF-8 byte-size of an oversized payload string
 * at content-lift sites, before it reaches the event-sourcing fold /
 * ComputedOutput.
 *
 * Why this exists
 * ---------------
 * Claude Code's content-unlock flags — `OTEL_LOG_RAW_API_BODIES` (=>
 * `claude_code.api_request_body` / `api_response_body` events carrying the full
 * Messages API request+response JSON) and `OTEL_LOG_TOOL_DETAILS` — emit the
 * assistant output text + tool I/O on OTLP LOG records. Claude caps each inline
 * body at ~60KB, but `=file:<dir>` mode and future versions can exceed that, and
 * a trace folds every record into a per-trace fold STATE in Redis via a
 * read-modify-write per event. A multi-megabyte body on that path bloats the
 * fold state, saturates the single-threaded Redis command loop, and collapses
 * folding throughput — the same failure mode that took down ingestion in the
 * fat-payload CH-merge incident.
 *
 * Behaviour
 * ---------
 * - Returns a string whose UTF-8 byte size exceeds the (generous,
 *   shared-with-spans) threshold as the kept head plus a short marker describing
 *   how much was cut; a value already within budget is returned untouched.
 * - The threshold (256KB) sits far above Claude's 60KB inline body cap, so
 *   normal collect-everything traffic is byte-for-byte untouched; only the
 *   pathological multi-MB payload is bounded.
 * - The marker embeds the original byte size (and an optional `label`) so a cut
 *   is self-describing in the stored value, and it is counted against the budget
 *   so the result never exceeds `maxBytes`.
 */
import { DEFAULT_MAX_ATTRIBUTE_VALUE_BYTES } from "./capOversizedAttributes";

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
