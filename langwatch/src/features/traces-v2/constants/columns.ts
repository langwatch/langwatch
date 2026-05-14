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
    minWidth: 80,
  },
  {
    id: "trace",
    label: "Trace",
    section: "standard",
    visible: true,
    minWidth: 300,
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
];
