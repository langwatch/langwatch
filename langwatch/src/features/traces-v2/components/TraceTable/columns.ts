import { type ColumnDef, createColumnHelper } from "@tanstack/react-table";
import type { TraceListItem } from "../../types/trace";
import type { ConversationGroup } from "./conversationGroups";
import type { TraceGroup } from "./registry";
import type { ColumnMeta } from "./TraceTableShell";

const traceCol = createColumnHelper<TraceListItem>();
const convCol = createColumnHelper<ConversationGroup>();
const groupCol = createColumnHelper<TraceGroup>();

const num: ColumnMeta = { align: "right" };
const flex: ColumnMeta = { flex: true };

const traceColumnDefs = {
  time: traceCol.accessor("timestamp", {
    id: "time",
    header: "Time",
    // Body content is always a short relative string (`16d`, `2m`, `now`)
    // or a chevron + relative. 60px is wide enough for "TIME" header + sort
    // caret and tight enough that the trace name doesn't sit a thumb's
    // width away from the timestamp. Capping at 64px so a manual resize
    // can't balloon it back out either.
    size: 60,
    minSize: 56,
    maxSize: 64,
    enableResizing: false,
  }),
  trace: traceCol.accessor("name", {
    id: "trace",
    header: "Trace (summary)",
    // Was flex (`size: 9999, meta.flex`) so the column absorbed every
    // pixel of leftover space — fine on a typical lens with eight to
    // ten columns visible, but with a slimmer column set (or a
    // collapsed sidebar) the trace cell ballooned out to 800px+ of
    // mostly empty whitespace beside the name + ID. Pinning the
    // default to `560px` (and capping the resize range to 320–820)
    // keeps the cell legible when it has room AND prevents
    // pathological growth when the user trims columns. Resizing
    // still works because non-flex columns honour `getSize()` width
    // directly.
    size: 560,
    minSize: 320,
    maxSize: 820,
    enableSorting: false,
  }),
  // Broken-out alternates to the composite `trace` column. Lenses can mix
  // and match: engineers tend to prefer the dense `trace` summary; product
  // people prefer dedicated input/output columns. They live here as
  // first-class options so the column picker can toggle them. Trace name
  // and root span name are split because the composite cell falls back
  // from the former to the latter — exposing them separately lets the
  // user see both when they diverge.
  "trace-name": traceCol.accessor((row) => row.traceName ?? "", {
    id: "trace-name",
    header: "Trace name",
    size: 200,
    minSize: 140,
    enableSorting: false,
  }),
  "root-span-name": traceCol.accessor((row) => row.name ?? "", {
    id: "root-span-name",
    header: "Root span name",
    size: 200,
    minSize: 140,
    enableSorting: false,
  }),
  "root-span-type": traceCol.accessor((row) => row.rootSpanType ?? "", {
    id: "root-span-type",
    header: "Root span type",
    size: 90,
    minSize: 80,
    enableSorting: false,
  }),
  "trace-id": traceCol.accessor("traceId", {
    id: "trace-id",
    header: "Trace ID",
    size: 240,
    minSize: 180,
    enableSorting: false,
  }),
  input: traceCol.accessor("input", {
    id: "input",
    header: "Input",
    size: 9999,
    minSize: 320,
    meta: flex,
    enableSorting: false,
  }),
  output: traceCol.accessor("output", {
    id: "output",
    header: "Output",
    size: 9999,
    minSize: 320,
    meta: flex,
    enableSorting: false,
  }),
  "error-text": traceCol.accessor("error", {
    id: "error-text",
    header: "Error",
    size: 320,
    minSize: 220,
    enableSorting: false,
  }),
  service: traceCol.accessor("serviceName", {
    id: "service",
    header: "Service",
    // Bumped from 100→160 so the common case (`fraud-risk-checker`,
    // `user-profile-service`, `vercel-ai-app`) reads end-to-end without
    // truncating mid-word. Customers still resize/hide columns from
    // the toolbar; this is just a more useful default.
    size: 160,
    minSize: 110,
    enableSorting: false,
  }),
  duration: traceCol.accessor("durationMs", {
    // Min widths below are sized so the uppercase header label *and*
    // the sort chevron fit without clamping at the default column
    // width. The numeric content itself is short (`1.0s`, `$0.0016`)
    // so the header — not the body — drives the minimum.
    id: "duration",
    header: "Duration",
    size: 95,
    minSize: 95,
    meta: num,
  }),
  cost: traceCol.accessor("totalCost", {
    id: "cost",
    header: "Cost",
    size: 90,
    minSize: 80,
    meta: num,
  }),
  tokens: traceCol.accessor("totalTokens", {
    id: "tokens",
    header: "Tokens",
    size: 90,
    minSize: 85,
    meta: num,
  }),
  spans: traceCol.accessor("spanCount", {
    id: "spans",
    header: "Spans",
    size: 80,
    minSize: 75,
    meta: num,
  }),
  model: traceCol.accessor((row) => row.models[0] ?? "", {
    id: "model",
    header: "Model",
    size: 180,
    minSize: 140,
    enableSorting: false,
  }),
  evaluations: traceCol.accessor((row) => row.evaluations.length, {
    id: "evaluations",
    header: "Evals",
    // Default sized for the common case (0–2 evaluator chips per row).
    // With chips capped at ~120px each (name truncated to 80px + score +
    // borders + gap), 280px fits the typical two-chip row without
    // padding waste; long evaluator names truncate inside the chip and
    // surface the full name on hover. `maxSize` keeps an over-eager
    // resize from punching the trace column off-screen.
    size: 280,
    minSize: 160,
    maxSize: 640,
    enableSorting: false,
  }),
  events: traceCol.accessor((row) => row.events.length, {
    id: "events",
    header: "Events",
    size: 250,
    minSize: 140,
    enableSorting: false,
  }),
  status: traceCol.accessor("status", {
    id: "status",
    header: "Status",
    size: 70,
    minSize: 70,
    enableSorting: false,
  }),
  ttft: traceCol.accessor((row) => row.ttft ?? 0, {
    id: "ttft",
    header: "TTFT",
    size: 80,
    minSize: 75,
    meta: num,
  }),
  userId: traceCol.accessor((row) => row.userId ?? "", {
    id: "userId",
    header: "User ID",
    size: 120,
    minSize: 100,
    enableSorting: false,
  }),
  conversationId: traceCol.accessor((row) => row.conversationId ?? "", {
    id: "conversationId",
    header: "Conversation ID",
    size: 140,
    minSize: 120,
    enableSorting: false,
  }),
  origin: traceCol.accessor("origin", {
    id: "origin",
    header: "Origin",
    // Fits the longest expected label ("Application", 11 chars) +
    // badge padding + the header chevron.
    size: 130,
    minSize: 120,
    enableSorting: false,
  }),
  tokensIn: traceCol.accessor((row) => row.inputTokens ?? 0, {
    id: "tokensIn",
    header: "Tokens In",
    size: 105,
    minSize: 100,
    meta: num,
  }),
  tokensOut: traceCol.accessor((row) => row.outputTokens ?? 0, {
    id: "tokensOut",
    header: "Tokens Out",
    size: 115,
    minSize: 110,
    meta: num,
  }),
} satisfies Record<string, ColumnDef<TraceListItem, any>>;

/**
 * Union of every id present in `traceColumnDefs`. Used to constrain the
 * STANDARD_COLUMNS list and the cell registry — adding an id to one place
 * but not the others becomes a compile error instead of a silent blank cell.
 */
export type TraceColumnId = keyof typeof traceColumnDefs;

const conversationColumnDefs: Record<
  string,
  ColumnDef<ConversationGroup, any>
> = {
  conversation: convCol.accessor("conversationId", {
    id: "conversation",
    header: "Conversation",
    size: 9999,
    minSize: 320,
    meta: flex,
  }),
  started: convCol.accessor("earliestTimestamp", {
    id: "started",
    header: "Started",
    size: 80,
    minSize: 70,
  }),
  lastTurn: convCol.accessor("latestTimestamp", {
    id: "lastTurn",
    header: "Last Turn",
    size: 80,
    minSize: 70,
  }),
  turns: convCol.accessor((row) => row.traces.length, {
    id: "turns",
    header: "Turns",
    size: 50,
    minSize: 50,
    meta: num,
  }),
  duration: convCol.accessor("totalDuration", {
    id: "duration",
    header: "Dur",
    size: 70,
    minSize: 70,
    meta: num,
  }),
  cost: convCol.accessor("totalCost", {
    id: "cost",
    header: "Cost",
    size: 70,
    minSize: 70,
    meta: num,
  }),
  tokens: convCol.accessor("totalTokens", {
    id: "tokens",
    header: "Tokens",
    size: 70,
    minSize: 70,
    meta: num,
  }),
  model: convCol.accessor("primaryModel", {
    id: "model",
    header: "Model",
    size: 100,
    minSize: 100,
  }),
  service: convCol.accessor("serviceName", {
    id: "service",
    header: "Service",
    size: 160,
    minSize: 110,
  }),
  status: convCol.accessor("worstStatus", {
    id: "status",
    header: "Status",
    size: 60,
    minSize: 60,
  }),
};

const GROUP_BY_LABEL: Record<"service" | "model" | "user", string> = {
  service: "Service",
  model: "Model",
  user: "User",
};

function buildGroupColumnDefs(
  groupBy: "service" | "model" | "user",
): Record<string, ColumnDef<TraceGroup, any>> {
  return {
    group: groupCol.accessor("label", {
      id: "group",
      header: GROUP_BY_LABEL[groupBy],
      size: 9999,
      minSize: 240,
      meta: flex,
    }),
    count: groupCol.accessor((row) => row.traces.length, {
      id: "count",
      header: "Traces",
      size: 70,
      minSize: 60,
      meta: num,
    }),
    duration: groupCol.accessor("avgDuration", {
      id: "duration",
      header: "Avg Dur",
      size: 80,
      minSize: 70,
      meta: num,
    }),
    cost: groupCol.accessor("totalCost", {
      id: "cost",
      header: "Total Cost",
      size: 80,
      minSize: 80,
      meta: num,
    }),
    tokens: groupCol.accessor("totalTokens", {
      id: "tokens",
      header: "Total Tokens",
      size: 90,
      minSize: 80,
      meta: num,
    }),
    errors: groupCol.accessor("errorCount", {
      id: "errors",
      header: "Errors",
      size: 70,
      minSize: 60,
      meta: num,
    }),
  };
}

// Cast at the index site: column ids fed in here are user-controlled
// (lens config, URL fragment) so we treat them as `string` and accept that
// some values may not be a known column.
const traceColumnDefsByString = traceColumnDefs as Record<
  string,
  ColumnDef<TraceListItem, any> | undefined
>;

export function buildTraceColumns(
  ids: string[],
): Array<ColumnDef<TraceListItem, any>> {
  return ids
    .map((id) => traceColumnDefsByString[id])
    .filter((def): def is ColumnDef<TraceListItem, any> => Boolean(def));
}

export function buildConversationColumns(
  ids: string[],
): Array<ColumnDef<ConversationGroup, any>> {
  return ids
    .map((id) => conversationColumnDefs[id])
    .filter((def): def is ColumnDef<ConversationGroup, any> => Boolean(def));
}

export function buildGroupColumns(
  ids: string[],
  groupBy: "service" | "model" | "user",
): Array<ColumnDef<TraceGroup, any>> {
  const defs = buildGroupColumnDefs(groupBy);
  return ids
    .map((id) => defs[id])
    .filter((def): def is ColumnDef<TraceGroup, any> => Boolean(def));
}

export const allTraceColumnIds = Object.keys(traceColumnDefs);
export const allConversationColumnIds = Object.keys(conversationColumnDefs);
