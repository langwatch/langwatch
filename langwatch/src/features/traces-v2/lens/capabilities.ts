import type {
  GroupingMode,
  SortConfig,
} from "../stores/viewStore";

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
  /** Pinned columns must always be selected; rendered as disabled-on. */
  pinned?: boolean;
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
    { id: "time", label: "Time", section: "Standard", pinned: true },
    { id: "trace", label: "Trace", section: "Standard" },
    { id: "service", label: "Service", section: "Standard" },
    { id: "duration", label: "Duration", section: "Standard" },
    { id: "cost", label: "Cost", section: "Standard" },
    { id: "tokens", label: "Tokens", section: "Standard" },
    { id: "tokensIn", label: "Tokens In", section: "Standard" },
    { id: "tokensOut", label: "Tokens Out", section: "Standard" },
    { id: "spans", label: "Spans", section: "Standard" },
    { id: "model", label: "Model", section: "Standard" },
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
    "ttft",
  ],
  defaultSort: { columnId: "time", direction: "desc" },
};

const CONVERSATION_CAPABILITY: LensCapability = {
  columns: [
    { id: "conversation", label: "Conversation", pinned: true },
    { id: "turns", label: "Turns" },
    { id: "started", label: "Started" },
    { id: "lastTurn", label: "Last Turn" },
    { id: "duration", label: "Duration" },
    { id: "cost", label: "Cost" },
    { id: "tokens", label: "Tokens" },
    { id: "model", label: "Model" },
    { id: "service", label: "Service" },
    { id: "status", label: "Status" },
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
  sortableColumnIds: ["started", "lastTurn", "duration", "cost", "tokens", "turns"],
  defaultSort: { columnId: "started", direction: "desc" },
};

function makeGroupCapability(label: string): LensCapability {
  return {
    columns: [
      { id: "group", label, pinned: true },
      { id: "count", label: "Traces" },
      { id: "duration", label: "Avg duration" },
      { id: "cost", label: "Total cost" },
      { id: "tokens", label: "Total tokens" },
      { id: "errors", label: "Errors" },
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

/** Drop ids that the capability doesn't expose — protects against stale state. */
export function reconcileColumns(
  ids: readonly string[],
  capability: LensCapability,
): string[] {
  const valid = capability.columns.map((c) => c.id);
  const validSet = new Set(valid);
  const filtered = ids.filter((id) => validSet.has(id));
  // Always retain pinned columns.
  for (const col of capability.columns) {
    if (col.pinned && !filtered.includes(col.id)) filtered.unshift(col.id);
  }
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
