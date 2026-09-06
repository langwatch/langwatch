/**
 * The framework's idempotency-key convention for command-emitted events:
 * `<commandId>:<index>`. A caller mints one commandId, retries reuse it, and
 * every event a handler emits for it keys on the commandId plus its position
 * in the emission — so a retried command dedupes at the event store (on
 * read; a restated row is still a row written) while a legitimately repeated
 * action, with its own commandId, never can.
 *
 * Owned here rather than by any one pipeline: the grants and identity
 * pipelines both stamp this key, and a convention two pipelines share is the
 * framework's to state.
 */
export function eventIdempotencyKey({
  commandId,
  index,
}: {
  commandId: string;
  index: number;
}): string {
  return `${commandId}:${index}`;
}
