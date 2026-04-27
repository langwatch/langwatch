import type { ColumnConfig } from "../stores/viewStore";

export const STANDARD_COLUMNS: ColumnConfig[] = [
  { id: "time", label: "Time", section: "standard", visible: true, pinned: "left", minWidth: 80 },
  { id: "trace", label: "Trace", section: "standard", visible: true, minWidth: 300 },
  { id: "service", label: "Service", section: "standard", visible: true, minWidth: 120 },
  { id: "duration", label: "Duration", section: "standard", visible: true, minWidth: 80 },
  { id: "cost", label: "Cost", section: "standard", visible: true, minWidth: 80 },
  { id: "tokens", label: "Tokens", section: "standard", visible: true, minWidth: 80 },
  { id: "model", label: "Model", section: "standard", visible: true, minWidth: 100 },
  { id: "evaluations", label: "Evals", section: "evaluations", visible: true, minWidth: 200 },
  { id: "events", label: "Events", section: "events", visible: true, minWidth: 140 },
  { id: "status", label: "Status", section: "standard", visible: false, minWidth: 70 },
  { id: "ttft", label: "TTFT", section: "standard", visible: false, minWidth: 80 },
  { id: "userId", label: "User ID", section: "standard", visible: false, minWidth: 100 },
  { id: "conversationId", label: "Conversation ID", section: "standard", visible: false, minWidth: 120 },
  { id: "origin", label: "Origin", section: "standard", visible: false, minWidth: 100 },
  { id: "tokensIn", label: "Tokens In", section: "standard", visible: false, minWidth: 80 },
  { id: "tokensOut", label: "Tokens Out", section: "standard", visible: false, minWidth: 80 },
  { id: "spanCount", label: "Span count", section: "standard", visible: false, minWidth: 80 },
];

export const DEFAULT_VISIBLE_COLUMNS = STANDARD_COLUMNS
  .filter((c) => c.visible)
  .map((c) => c.id);

export const CONVERSATION_COLUMNS: ColumnConfig[] = [
  { id: "conversation", label: "Conversation", section: "standard", visible: true, minWidth: 280 },
  { id: "turns", label: "Turns", section: "standard", visible: true, minWidth: 60 },
  { id: "duration", label: "Duration", section: "standard", visible: true, minWidth: 80 },
  { id: "cost", label: "Cost", section: "standard", visible: true, minWidth: 80 },
  { id: "tokens", label: "Tokens", section: "standard", visible: true, minWidth: 80 },
  { id: "model", label: "Model", section: "standard", visible: true, minWidth: 100 },
  { id: "service", label: "Service", section: "standard", visible: true, minWidth: 120 },
  { id: "status", label: "Status", section: "standard", visible: true, minWidth: 70 },
];

export function getColumnConfig(columnId: string): ColumnConfig | undefined {
  return (
    STANDARD_COLUMNS.find((c) => c.id === columnId) ??
    CONVERSATION_COLUMNS.find((c) => c.id === columnId)
  );
}
