/**
 * Dual-stream reconciliation (ADR-048).
 *
 * The live answer has two sources for its text:
 *   - DURABLE (Stream A): the useChat text bridged from the Redis token buffer.
 *     Authoritative and replayable, but arrives in ~64-word batches.
 *   - FAST (Stream B): the raw opencode tokens over the ephemeral pub/sub SSE.
 *     Per-token and ahead, but best-effort — it may have a gap (subscribed a
 *     token late) and it dies on disconnect.
 *
 * `reconcileOptimisticText` picks what to render, length-monotonically: show the
 * fast text ONLY while it is a prefix-consistent superset of the durable text.
 * That shows the fast lead the instant it exists (durable starts empty, and
 * `"".startsWith` is always true) and keeps it ahead as the durable batches
 * catch up — but the moment the fast text is NOT a clean superset (a dropped
 * token), it falls back to the durable text, so the UI can never render
 * corrupted or mis-prefixed prose.
 */
export function reconcileOptimisticText(
  durableText: string,
  fastText: string | undefined | null,
): string {
  if (
    fastText &&
    fastText.length > durableText.length &&
    fastText.startsWith(durableText)
  ) {
    return fastText;
  }
  return durableText;
}
