import type { SpanTreeNode } from "~/server/api/routers/tracesV2.schemas";

export interface SpanListViewProps {
  spans: SpanTreeNode[];
  selectedSpanId: string | null;
  onSelectSpan: (spanId: string) => void;
  onClearSpan: () => void;
  initialSearch?: string;
  initialTypeFilter?: string;
}

export type SortField =
  | "name"
  | "type"
  | "duration"
  | "model"
  | "status"
  | "start";
export type SortDirection = "asc" | "desc";

export interface DerivedSpan {
  span: SpanTreeNode;
  duration: number;
  startOffset: number;
}
