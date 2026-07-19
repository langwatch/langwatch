import type { GroupingMode, SortConfig } from "../stores/viewStore";
import { isEvalColumnId } from "./evalColumnId";

/**
 * Single source of truth for "what can a lens look like under grouping X".
 *
 * Every grouping mode renders a different `RowKind` (trace / conversation /
 * group), and each row kind has its own column registry + addon registry.
 * Surfacing those constraints as a flat capability descriptor keeps the
 * lens dialog, validation schema, and any future server-side guard in lockstep
 * — adding a new grouping mode means extending exactly this file (plus the
 * underlying registries).
 */

export interface LensColumnOption {
  id: string;
  label: string;
  /** Optional UI grouping label inside the columns list (e.g. "Evaluations"). */
  section?: string;
}

export interface LensAddonOption {
  id: string;
  label: string;
}

export interface LensCapability {
  /** All columns that can be picked under this grouping. */
  columns: readonly LensColumnOption[];
  /** Default column set used when the user hasn't explicitly chosen any. */
  defaultColumns: readonly string[];
  /** Row addons available for this grouping's RowKind. */
  addons: readonly LensAddonOption[];
  /** Subset of column ids the backend can actually sort on. */
  sortableColumnIds: readonly string[];
  /** Default sort applied if the user clears the picker. */
  defaultSort: SortConfig;
}

const TRACE_CAPABILITY: LensCapability = {
  columns: [
    { id: "time", label: "Time", section: "Standard" },
    // Sibling time columns — TIME is the default tight relative ("3m"),
    // SINCE is the verbose form ("3 minutes ago"), TIMESTAMP is the
    // full ISO 8601 for log-query copy-paste. Same row hover, three
    // formats — users pick whichever reads best for their workflow.
    { id: "since", label: "Since (verbose)", section: "Standard" },
    { id: "timestamp", label: "Timestamp (ISO)", section: "Standard" },
    { id: "trace", label: "Trace (summary)", section: "Standard" },
    // Broken-out alternates to the composite Trace summary — let users
    // assemble the column shape they prefer (engineer-friendly summary
    // vs. PM-friendly per-field columns) without a hidden density mode.
    // Trace name and root span name are split because the composite
    // falls back between them; either may be empty in real data.
    { id: "trace-name", label: "Trace name", section: "Trace fields" },
    { id: "root-span-name", label: "Root span name", section: "Trace fields" },
    { id: "root-span-type", label: "Root span type", section: "Trace fields" },
    { id: "trace-id", label: "Trace ID", section: "Trace fields" },
    { id: "input", label: "Input", section: "Trace fields" },
    { id: "output", label: "Output", section: "Trace fields" },
    { id: "prompt", label: "Prompt", section: "Trace fields" },
    { id: "error-text", label: "Error", section: "Trace fields" },
    { id: "service", label: "Service", section: "Standard" },
    { id: "duration", label: "Duration", section: "Standard" },
    { id: "cost", label: "Cost", section: "Standard" },
    { id: "tokens", label: "Tokens", section: "Standard" },
    { id: "tokensIn", label: "Tokens In", section: "Standard" },
    { id: "tokensOut", label: "Tokens Out", section: "Standard" },
    { id: "spans", label: "Spans", section: "Standard" },
    { id: "size", label: "Storage size", section: "Standard" },
    { id: "model", label: "Model", section: "Standard" },
    { id: "labels", label: "Labels", section: "Standard" },
    { id: "status", label: "Status", section: "Standard" },
    { id: "ttft", label: "TTFT", section: "Standard" },
    { id: "userId", label: "User ID", section: "Standard" },
    { id: "conversationId", label: "Conversation ID", section: "Standard" },
    { id: "origin", label: "Origin", section: "Standard" },
    { id: "evaluations", label: "Evals", section: "Evaluations" },
    { id: "events", label: "Events", section: "Events" },
  ],
  defaultColumns: [
    "time",
    "trace",
    "service",
    "duration",
    "cost",
    "tokens",
    "model",
    "labels",
  ],
  addons: [
    { id: "io-preview", label: "I/O preview" },
    { id: "expanded-peek", label: "Span tree (expanded)" },
    { id: "error-detail", label: "Error detail" },
  ],
  sortableColumnIds: [
    "time",
    "duration",
    "cost",
    "tokens",
    "tokensIn",
    "tokensOut",
    "spans",
    "size",
    "ttft",
  ],
  defaultSort: { columnId: "time", direction: "desc" },
};

const CONVERSATION_CAPABILITY: LensCapability = {
  // Sections mirror the trace-grouping shape so the Columns dropdown
  // can render the same "Standard" section header on every grouping —
  // without this the dropdown falls back to "Other" for any column
  // missing a section, which reads as broken next to the dialog version.
  columns: [
    { id: "conversation", label: "Conversation", section: "Standard" },
    { id: "turns", label: "Turns", section: "Standard" },
    { id: "started", label: "Started", section: "Standard" },
    { id: "lastTurn", label: "Last Turn", section: "Standard" },
    { id: "duration", label: "Duration", section: "Standard" },
    { id: "cost", label: "Cost", section: "Standard" },
    { id: "tokens", label: "Tokens", section: "Standard" },
    { id: "model", label: "Model", section: "Standard" },
    { id: "service", label: "Service", section: "Standard" },
    { id: "status", label: "Status", section: "Standard" },
  ],
  defaultColumns: [
    "conversation",
    "turns",
    "duration",
    "cost",
    "tokens",
    "model",
    "service",
    "status",
  ],
  addons: [{ id: "conversation-turns", label: "Conversation turns" }],
  sortableColumnIds: [
    "started",
    "lastTurn",
    "duration",
    "cost",
    "tokens",
    "turns",
  ],
  defaultSort: { columnId: "started", direction: "desc" },
};

function makeGroupCapability(label: string): LensCapability {
  return {
    columns: [
      { id: "group", label, section: "Standard" },
      { id: "count", label: "Traces", section: "Standard" },
      { id: "duration", label: "Avg duration", section: "Standard" },
      { id: "cost", label: "Total cost", section: "Standard" },
      { id: "tokens", label: "Total tokens", section: "Standard" },
      { id: "errors", label: "Errors", section: "Standard" },
    ],
    defaultColumns: ["group", "count", "duration", "cost", "tokens", "errors"],
    addons: [{ id: "group-traces", label: "Group traces" }],
    sortableColumnIds: ["count", "duration", "cost", "tokens", "errors"],
    defaultSort: { columnId: "count", direction: "desc" },
  };
}

export const LENS_CAPABILITIES: Record<GroupingMode, LensCapability> = {
  flat: TRACE_CAPABILITY,
  "by-conversation": CONVERSATION_CAPABILITY,
  "by-service": makeGroupCapability("Service"),
  "by-user": makeGroupCapability("User"),
  "by-model": makeGroupCapability("Model"),
};

export const GROUPING_LABELS: Record<GroupingMode, string> = {
  flat: "Flat",
  "by-conversation": "By Conversation",
  "by-service": "By Service",
  "by-user": "By User",
  "by-model": "By Model",
};

export function getCapability(grouping: GroupingMode): LensCapability {
  return LENS_CAPABILITIES[grouping];
}

/**
 * Drop ids that the capability doesn't expose — protects against stale
 * state. Dynamic per-evaluator `eval:*` columns are retained only for the
 * trace (flat) capability — the one that renders per-trace `evaluations`;
 * they are dropped from conversation/group lenses where they'd be dead ids.
 * A retained eval column whose evaluator has no runs in range renders
 * em-dashes rather than vanishing (see
 * dev/docs/adr/029-trace-table-per-evaluator-columns.md).
 */
export function reconcileColumns({
  ids,
  capability,
}: {
  ids: readonly string[];
  capability: LensCapability;
}): string[] {
  const valid = capability.columns.map((c) => c.id);
  const validSet = new Set(valid);
  // The trace capability is the one exposing the evals summary column.
  const isTraceCapability = validSet.has("evaluations");
  const filtered = ids.filter(
    (id) => validSet.has(id) || (isTraceCapability && isEvalColumnId(id)),
  );
  return filtered.length > 0 ? filtered : [...capability.defaultColumns];
}

export function reconcileAddons(
  ids: readonly string[],
  capability: LensCapability,
): string[] {
  const valid = new Set(capability.addons.map((a) => a.id));
  return ids.filter((id) => valid.has(id));
}

export function reconcileSort(
  sort: SortConfig,
  capability: LensCapability,
): SortConfig {
  const sortable = new Set(capability.sortableColumnIds);
  if (sortable.has(sort.columnId)) return sort;
  return { ...capability.defaultSort };
}
