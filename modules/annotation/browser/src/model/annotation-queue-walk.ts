/** The queue walk's addresses and labels, as every way into the walker writes them. */

/** Where a queue item is read. One shape, so every way in agrees. */
export function queueItemHref({
  projectSlug,
  queueItemId,
}: {
  projectSlug: string | undefined;
  queueItemId?: string | undefined;
}): string {
  return queueItemId
    ? `/${projectSlug}/annotations/my-queue?queue-item=${queueItemId}`
    : `/${projectSlug}/annotations/my-queue`;
}

/** The bar's hand-off switch, carrying what it would hand over. */
export function datasetToggleLabel(sessionCount: number): string {
  if (sessionCount === 0) return "Add to dataset at the end";
  const traces = sessionCount === 1 ? "1 trace" : `${sessionCount} traces`;
  return `Add to dataset at the end (${traces})`;
}

/** A trace timestamp is only useful to the drawer when it is a real number. */
export function partitionHint(startedAt: unknown): number | null {
  return typeof startedAt === "number" && Number.isFinite(startedAt) ? startedAt : null;
}

/** The thread a queued trace belongs to, when its metadata names one. */
export function readConversationId(metadata: unknown): string | null {
  if (typeof metadata !== "object" || metadata === null || !("thread_id" in metadata)) return null;
  const threadId = metadata.thread_id;
  return typeof threadId === "string" && threadId !== "" ? threadId : null;
}
