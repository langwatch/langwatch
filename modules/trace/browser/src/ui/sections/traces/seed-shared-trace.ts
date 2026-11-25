import type { api, RouterOutputs } from "../../../behavior/trace-api.ts";

type SharedTrace = RouterOutputs["sharedTrace"]["get"];

/**
 * Puts the share page's one payload into the cache under the keys the drawer's
 * hooks read, with and without the partition hint the header read backfills.
 */
export function seedSharedTrace({
  utils,
  projectId,
  shared,
}: {
  utils: ReturnType<typeof api.useUtils>;
  projectId: string;
  shared: SharedTrace;
}): void {
  const base = { projectId, traceId: shared.header.traceId };
  for (const input of [base, { ...base, occurredAtMs: shared.header.timestamp }]) {
    utils.traces.header.setData({ ...input, full: true }, shared.header);
    utils.traces.spanTree.setData(input, shared.spanTree);
    utils.traces.spansFull.setData(input, shared.spansFull);
    utils.traces.spanLangwatchSignals.setData(input, shared.spanSignals);
    utils.traces.traceEvents.setData(input, shared.events);
    utils.traces.resourceInfo.setData(input, shared.resources);
    for (const span of shared.spansFull) {
      utils.traces.spanDetail.setData({ ...input, spanId: span.spanId }, span);
    }
  }
  utils.traces.getEvaluations.setData(base, shared.evaluations);
}
