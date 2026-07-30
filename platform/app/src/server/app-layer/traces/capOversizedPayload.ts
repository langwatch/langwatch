/**
 * Bounds an oversized payload string before it reaches a trace fold.
 *
 * Claude Code's content-unlock flags emit the full Messages API request and
 * response bodies on OTLP log records. Claude caps each inline body at ~60KB,
 * but `=file:<dir>` mode can exceed it, and a trace folds every record into a
 * per-trace state via a read-modify-write per event — so a multi-megabyte body
 * on that path bloats the fold state and saturates the Redis command loop.
 *
 * The threshold sits far above the 60KB inline cap, so ordinary
 * collect-everything traffic is byte-for-byte untouched and only a pathological
 * payload is cut.
 */

/** Also the boundary the job spool tiers on, so a retune moves both together
 * (`COMMAND_INLINE_THRESHOLD` in ./lean-for-projection is the same value). */
export const DEFAULT_MAX_PAYLOAD_BYTES = 256 * 1024;

function capStringWithFlag(
  value: string,
  maxBytes: number,
  label?: string,
): { value: string; capped: boolean } {
  const byteSize = Buffer.byteLength(value, "utf8");
  if (byteSize <= maxBytes) return { value, capped: false };
  const labelPart = label ? ` ${label}` : "";
  const marker = `…[langwatch: truncated${labelPart}, ${byteSize} bytes total]`;
  const budget = Math.max(0, maxBytes - Buffer.byteLength(marker, "utf8"));
  // subarray on a UTF-8 buffer can split a multibyte sequence; toString
  // tolerates it (one replacement char), which is fine for a truncation tail
  // and keeps the result strictly under budget.
  const head = Buffer.from(value, "utf8").subarray(0, budget).toString("utf8");
  return { value: head + marker, capped: true };
}

/**
 * Caps a lifted content string. `label` is embedded in the marker so a cut is
 * self-describing in the stored value — telemetry without a logger dependency
 * on the hot path. The marker counts against the budget, so the result never
 * exceeds `maxBytes`.
 */
export function capPayloadString(
  value: string,
  maxBytes: number = DEFAULT_MAX_PAYLOAD_BYTES,
  label?: string,
): string {
  return capStringWithFlag(value, maxBytes, label).value;
}
