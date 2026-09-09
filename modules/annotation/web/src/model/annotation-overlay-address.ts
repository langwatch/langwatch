/**
 * The addresses this family's rows open, as query writes. A drawer hydrates
 * from `drawer.open` plus its `drawer.*` parameters; every write clears the
 * `drawer.` keys already present and leaves the rest of the address alone.
 */

/** The whole-query write a route port takes: `undefined` removes a key. */
export type AnnotationQueryWrite = Record<string, string | undefined>;

/** Clears every `drawer.` key the current address carries. */
function withoutDrawerKeys(
  current: Readonly<Record<string, string | undefined>>,
): AnnotationQueryWrite {
  const next: AnnotationQueryWrite = {};

  for (const [key, value] of Object.entries(current)) {
    next[key] = key.startsWith("drawer.") ? void 0 : value;
  }

  return next;
}

/**
 * The trace explorer's drawer on one trace. `drawer.t` is the partition hint,
 * sent only when the row knows it (`toOccurredAtMsHint`).
 */
export function traceDetailsAddress({
  current,
  traceId,
  occurredAtMs,
}: {
  current: Readonly<Record<string, string | undefined>>;
  traceId: string;
  occurredAtMs?: number;
}): AnnotationQueryWrite {
  return {
    ...withoutDrawerKeys(current),
    "drawer.open": "traceV2Details",
    "drawer.traceId": traceId,
    ...(occurredAtMs === void 0 ? {} : { "drawer.t": String(occurredAtMs) }),
  };
}

/** The dataset hand-off on the picked rows' traces; the ids travel comma-joined. */
export function addDatasetRecordAddress({
  current,
  traceIds,
}: {
  current: Readonly<Record<string, string | undefined>>;
  traceIds: readonly string[];
}): AnnotationQueryWrite {
  return {
    ...withoutDrawerKeys(current),
    "drawer.open": "addDatasetRecord",
    "drawer.selectedTraceIds": traceIds.join(","),
  };
}

/** The query key the queue editor opens from: an id to edit, `new` to create. */
export const QUEUE_EDITOR_PARAM = "queue-editor";

/** What the queue editor is open on right now, or `null` when it is closed. */
export function readQueueEditor(
  query: Readonly<Record<string, string | undefined>>,
): { queueId: string | undefined } | null {
  const value = query[QUEUE_EDITOR_PARAM];
  if (!value) return null;

  return { queueId: value === "new" ? void 0 : value };
}

/** Opens the queue editor on an existing queue, or on a new one. */
export function queueEditorAddress({
  current,
  queueId,
}: {
  current: Readonly<Record<string, string | undefined>>;
  queueId?: string;
}): AnnotationQueryWrite {
  return { ...current, [QUEUE_EDITOR_PARAM]: queueId ?? "new" };
}

/** Takes the queue editor back off. */
export function closedQueueEditorAddress(
  current: Readonly<Record<string, string | undefined>>,
): AnnotationQueryWrite {
  return { ...current, [QUEUE_EDITOR_PARAM]: void 0 };
}

/** Where a queue item that is still waiting takes the reviewer. */
export function queueItemHref({
  projectSlug,
  queueItemId,
  traceId,
}: {
  projectSlug: string | undefined;
  queueItemId: string;
  traceId: string;
}): string {
  return `/${projectSlug}/annotations/my-queue?queue-item=${queueItemId}&trace=${traceId}`;
}
