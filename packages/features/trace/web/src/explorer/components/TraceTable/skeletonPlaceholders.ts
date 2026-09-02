import type { TraceListItem } from "../../types/trace";
import { NO_TRACE_EVENTS } from "../../types/trace";
import type { ConversationGroup } from "./conversationGroups";
import type { TraceGroup } from "./registry";

/**
 * What a placeholder row's `traceId` starts with. Placeholder ids address no
 * trace, so anything that collects ids off the rendered rows and hands them to
 * a bulk action filters them out first with {@link withoutPlaceholderTraceIds}.
 */
export const SKELETON_TRACE_ID_PREFIX = "__skeleton_trace_";

/** Whether this id belongs to a loading placeholder rather than a real trace. */
export const isPlaceholderTraceId = (traceId: string): boolean =>
  traceId.startsWith(SKELETON_TRACE_ID_PREFIX);

/** The ids that address a real trace, in their original order. */
export const withoutPlaceholderTraceIds = (traceIds: string[]): string[] =>
  traceIds.filter((traceId) => !isPlaceholderTraceId(traceId));

/**
 * Synthetic `TraceListItem` rows that drive the loading skeleton via
 * the real `TraceLensBody`. The goal is to render the exact same row /
 * cell / addon tree the user will see once data lands so the column
 * widths, paddings, heights, and addon presence all match — no
 * layout jump on transition.
 *
 * Field values are intentionally meaningful enough that addons whose
 * `shouldRender` predicates check for non-null fields (e.g. the IO
 * preview addon) still trigger; the actual content rendered inside is
 * swapped for skeleton bars by `RegistryRow` when its `isLoading` prop
 * is set.
 */
export function buildTracePlaceholderRows(count: number): TraceListItem[] {
  return Array.from({ length: count }, (_, i) => ({
    traceId: `${SKELETON_TRACE_ID_PREFIX}${i}`,
    timestamp: Date.now(),
    name: "",
    serviceName: "",
    durationMs: 0,
    totalCost: 0,
    nonBilledCost: 0,
    totalTokens: 0,
    models: [],
    labels: [],
    status: "ok",
    spanCount: 0,
    sizeBytes: 0,
    // Non-null so addons keyed off these (IOPreviewAddon) still render.
    input: "",
    output: "",
    origin: "application",
    evaluations: [],
    events: NO_TRACE_EVENTS,
  }));
}

export function buildConversationPlaceholderRows(count: number): ConversationGroup[] {
  return Array.from({ length: count }, (_, i) => ({
    conversationId: `__skeleton_conv_${i}`,
    traces: [],
    traceCount: 0,
    totalDuration: 0,
    totalCost: 0,
    totalTokens: 0,
    totalSpans: 0,
    errorCount: 0,
    totalEvents: 0,
    totalEvals: 0,
    evalsPassedCount: 0,
    evalsFailedCount: 0,
    worstStatus: "ok",
    latestTimestamp: Date.now(),
    earliestTimestamp: Date.now(),
    lastMessage: "",
    lastOutput: "",
    primaryModel: "",
    serviceName: "",
  }));
}

export function buildGroupPlaceholderRows(count: number): TraceGroup[] {
  return Array.from({ length: count }, (_, i) => ({
    key: `__skeleton_group_${i}`,
    label: "",
    traces: [],
    avgDuration: 0,
    totalCost: 0,
    totalTokens: 0,
    errorCount: 0,
    worstStatus: "ok",
    groupBy: "service",
    index: i,
  }));
}
