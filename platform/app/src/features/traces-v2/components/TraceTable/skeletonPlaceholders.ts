import type { TraceListItem } from "../../types/trace";
import type { ConversationGroup } from "./conversationGroups";
import type { TraceGroup } from "./registry";

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
    traceId: `__skeleton_trace_${i}`,
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
    events: [],
  }));
}

export function buildConversationPlaceholderRows(
  count: number,
): ConversationGroup[] {
  return Array.from({ length: count }, (_, i) => ({
    conversationId: `__skeleton_conv_${i}`,
    traces: [],
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
