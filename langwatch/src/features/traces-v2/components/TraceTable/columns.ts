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

export const traceAtomicColumnDefs: Record<
  string,
  ColumnDef<TraceListItem, any>
> = {
  "span-name": traceCol.accessor((row) => row.rootSpanName ?? row.name, {
    id: "span-name",
    header: "Name",
    size: 200,
    minSize: 140,
  }),
  "span-type": traceCol.accessor((row) => row.rootSpanType ?? "", {
    id: "span-type",
    header: "Type",
    size: 80,
    minSize: 70,
  }),
  "trace-id": traceCol.accessor("traceId", {
    id: "trace-id",
    header: "Trace ID",
    size: 240,
    minSize: 180,
  }),
  input: traceCol.accessor("input", {
    id: "input",
    header: "Input",
    size: 9999,
    minSize: 200,
    meta: flex,
    enableSorting: false,
  }),
  output: traceCol.accessor("output", {
    id: "output",
    header: "Output",
    size: 9999,
    minSize: 200,
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
};

const traceColumnDefs: Record<string, ColumnDef<TraceListItem, any>> = {
  time: traceCol.accessor("timestamp", {
    id: "time",
    header: "Time",
    size: 60,
    minSize: 60,
    enableResizing: false,
  }),
  trace: traceCol.accessor("name", {
    id: "trace",
    header: "Trace",
    size: 9999,
    minSize: 200,
    meta: { ...flex, skeletonLines: 2 },
  }),
  service: traceCol.accessor("serviceName", {
    id: "service",
    header: "Service",
    size: 100,
    minSize: 90,
  }),
  duration: traceCol.accessor("durationMs", {
    id: "duration",
    header: "Duration",
    size: 80,
    minSize: 70,
    meta: num,
  }),
  cost: traceCol.accessor("totalCost", {
    id: "cost",
    header: "Cost",
    size: 80,
    minSize: 70,
    meta: num,
  }),
  tokens: traceCol.accessor("totalTokens", {
    id: "tokens",
    header: "Tokens",
    size: 65,
    minSize: 55,
    meta: num,
  }),
  spans: traceCol.accessor("spanCount", {
    id: "spans",
    header: "Spans",
    size: 60,
    minSize: 50,
    meta: num,
  }),
  model: traceCol.accessor((row) => row.models[0] ?? "", {
    id: "model",
    header: "Model",
    size: 120,
    minSize: 110,
  }),
  evaluations: traceCol.accessor((row) => row.evaluations.length, {
    id: "evaluations",
    header: "Evals",
    size: 400,
    minSize: 200,
    enableSorting: false,
  }),
  events: traceCol.accessor((row) => row.events.length, {
    id: "events",
    header: "Events",
    size: 250,
    minSize: 140,
    enableSorting: false,
  }),
};

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
    size: 100,
    minSize: 100,
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
      header: "Cost",
      size: 70,
      minSize: 70,
      meta: num,
    }),
    tokens: groupCol.accessor("totalTokens", {
      id: "tokens",
      header: "Tokens",
      size: 80,
      minSize: 70,
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

export function buildTraceColumns(
  ids: string[],
): Array<ColumnDef<TraceListItem, any>> {
  return ids
    .map((id) => traceColumnDefs[id])
    .filter((def): def is ColumnDef<TraceListItem, any> => Boolean(def));
}

export function getTraceColumnDef(
  id: string,
): ColumnDef<TraceListItem, any> | undefined {
  return traceColumnDefs[id] ?? traceAtomicColumnDefs[id];
}

export function makeEvalColumnDef(
  evaluatorId: string,
  evaluatorName: string | null,
): ColumnDef<TraceListItem, any> {
  return traceCol.accessor(
    (row) =>
      row.evaluations.find((e) => e.evaluatorId === evaluatorId)?.score ?? 0,
    {
      id: `eval:${evaluatorId}`,
      header: evaluatorName ?? evaluatorId,
      size: 130,
      minSize: 100,
      enableSorting: false,
    },
  );
}

export function makeEventColumnDef(
  name: string,
): ColumnDef<TraceListItem, any> {
  return traceCol.accessor(
    (row) => row.events.filter((e) => e.name === name).length,
    {
      id: `event:${name}`,
      header: name,
      size: 110,
      minSize: 90,
      enableSorting: false,
    },
  );
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
