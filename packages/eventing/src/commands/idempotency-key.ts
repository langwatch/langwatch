/**
 * Build the event idempotency key shared by command-driven pipelines.
 *
 * A caller mints one command id and reuses it on retries. The event position
 * keeps multiple events from the same command distinct while allowing the
 * event store to deduplicate a retried command.
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
