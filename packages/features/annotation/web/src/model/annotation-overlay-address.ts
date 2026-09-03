/**
 * The addresses this family's rows open, as query writes.
 *
 * `platform/app` wrote them through `useDrawer`, which is application
 * composition a feature-web package may not reach. What a drawer actually needs
 * is the address: `CurrentDrawer` hydrates itself from `drawer.open` plus the
 * `drawer.*` parameters, so writing the same keys is writing the same intent.
 *
 * KNOWN CHROME GAP, stated here rather than papered over. Both drawers named
 * below — `traceV2Details` and `addDatasetRecord` — are registered in
 * `platform/app` and mounted by `DashboardPageBody`, which is the application
 * chrome. A screen served from `apps/ui` has no chrome above it yet (the same
 * gap the coding-agent, me and automations families recorded), so on these
 * screens the address changes and nothing opens until the chrome layout route
 * lands. The address is still the right thing to write: it is what makes both
 * overlays come back for free when the chrome does, and it is what a shared
 * link already means.
 *
 * Every `drawer.` key already on the address is taken off first and everything
 * else is left alone, which is what the platform registry did — so opening a
 * trace from a queue page leaves the page's paging and date range standing
 * underneath it.
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
 * The trace explorer's own drawer, opened on one trace.
 *
 * `t` is the partition hint the drawer uses to find the trace without scanning
 * every partition; it travels only when the row actually knows it, which is
 * what `toOccurredAtMsHint` decides.
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

/**
 * The dataset hand-off, opened on the traces behind the picked rows.
 *
 * The platform registry took `selectedTraceIds` as an array; the address is
 * single-valued, so the ids travel comma-joined the way every other list-valued
 * drawer parameter does.
 */
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
