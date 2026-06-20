import type { TraceColumnId } from "../components/TraceTable/columns";
import type { ColumnConfig } from "../stores/viewStore";

/**
 * Every entry's `id` must be a valid TraceColumnId — otherwise the dropdown
 * exposes a column the renderer can't render. Compile error if an id slips
 * out of sync with the column-def registry.
 */
type StandardColumnConfig = ColumnConfig & { id: TraceColumnId };

export const STANDARD_COLUMNS: readonly StandardColumnConfig[] = [
  {
    id: "time",
    label: "Time",
    section: "standard",
    visible: true,
    pinned: "left",
    minWidth: 68,
  },
  {
    id: "trace",
    label: "Trace (summary)",
    section: "standard",
    visible: true,
    minWidth: 300,
  },
  {
    id: "trace-name",
    label: "Trace name",
    section: "fields",
    visible: false,
    minWidth: 140,
  },
  {
    id: "root-span-name",
    label: "Root span name",
    section: "fields",
    visible: false,
    minWidth: 140,
  },
  {
    id: "root-span-type",
    label: "Root span type",
    section: "fields",
    visible: false,
    minWidth: 80,
  },
  {
    id: "trace-id",
    label: "Trace ID",
    section: "fields",
    visible: false,
    minWidth: 180,
  },
  {
    id: "input",
    label: "Input",
    section: "fields",
    visible: false,
    minWidth: 320,
  },
  {
    id: "output",
    label: "Output",
    section: "fields",
    visible: false,
    minWidth: 320,
  },
  {
    id: "error-text",
    label: "Error",
    section: "fields",
    visible: false,
    minWidth: 220,
  },
  {
    id: "service",
    label: "Service",
    section: "standard",
    visible: true,
    minWidth: 120,
  },
  {
    id: "duration",
    label: "Duration",
    section: "standard",
    visible: true,
    minWidth: 80,
  },
  {
    id: "cost",
    label: "Cost",
    section: "standard",
    visible: true,
    minWidth: 80,
  },
  {
    id: "tokens",
    label: "Tokens",
    section: "standard",
    visible: true,
    minWidth: 80,
  },
  {
    id: "model",
    label: "Model",
    section: "standard",
    visible: true,
    minWidth: 100,
  },
  {
    id: "labels",
    label: "Labels",
    section: "standard",
    visible: true,
    minWidth: 140,
  },
  {
    id: "prompt",
    label: "Prompt",
    section: "fields",
    visible: false,
    minWidth: 140,
  },
  {
    id: "evaluations",
    label: "Evals",
    section: "evaluations",
    visible: true,
    minWidth: 200,
  },
  {
    id: "events",
    label: "Events",
    section: "events",
    visible: true,
    minWidth: 140,
  },
  {
    id: "status",
    label: "Status",
    section: "standard",
    visible: false,
    minWidth: 70,
  },
  {
    id: "ttft",
    label: "TTFT",
    section: "standard",
    visible: false,
    minWidth: 80,
  },
  {
    id: "userId",
    label: "User ID",
    section: "standard",
    visible: false,
    minWidth: 100,
  },
  {
    id: "conversationId",
    label: "Conversation ID",
    section: "standard",
    visible: false,
    // Pinned like Time: a conversation is the trace's identity in
    // multi-turn views, so when the column is enabled it stays frozen at
    // the left edge rather than scrolling away among the metrics.
    pinned: "left",
    minWidth: 120,
  },
  {
    id: "origin",
    label: "Origin",
    section: "standard",
    visible: false,
    minWidth: 100,
  },
  {
    id: "tokensIn",
    label: "Tokens In",
    section: "standard",
    visible: false,
    minWidth: 80,
  },
  {
    id: "tokensOut",
    label: "Tokens Out",
    section: "standard",
    visible: false,
    minWidth: 80,
  },
  {
    id: "spans",
    label: "Spans",
    section: "standard",
    visible: false,
    minWidth: 60,
  },
  {
    id: "size",
    label: "Storage size",
    section: "standard",
    visible: false,
    minWidth: 110,
  },
];
