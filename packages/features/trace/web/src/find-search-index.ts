import { useMemo, useRef } from "react";

export type TraceSearchItem = {
  traceId: string;
  name: string;
  serviceName: string;
  input: string | null;
  output: string | null;
  error?: string;
  errorSpanName?: string;
  conversationId?: string;
  userId?: string;
  traceName?: string;
  models: string[];
  evaluations: Array<{
    evaluatorName: string | null;
    label: string | null;
  }>;
  events: {
    groups: Array<{ name: string }>;
  };
};

const MIN_QUERY_LENGTH = 2;

function buildSearchableText(trace: TraceSearchItem): string {
  const evaluationText = trace.evaluations
    .map((evaluation) => `${evaluation.evaluatorName ?? ""} ${evaluation.label ?? ""}`)
    .join(" ");
  const eventText = trace.events.groups.map((event) => event.name).join(" ");

  return [
    trace.traceId,
    trace.name,
    trace.serviceName,
    trace.input,
    trace.output,
    trace.error,
    trace.errorSpanName,
    trace.conversationId,
    trace.userId,
    trace.traceName,
    trace.models.join(" "),
    evaluationText,
    eventText,
  ]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .join(" ")
    .toLowerCase();
}

export function useTraceSearchIndex({
  traces,
  query,
}: {
  traces: TraceSearchItem[];
  query: string;
}): string[] {
  const cacheRef = useRef<{
    traces: TraceSearchItem[];
    map: Map<string, string>;
  }>({ traces: [], map: new Map() });

  if (cacheRef.current.traces !== traces) {
    cacheRef.current = { traces, map: new Map() };
  }

  return useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle.length < MIN_QUERY_LENGTH) return [];

    const cache = cacheRef.current.map;
    const matches: string[] = [];
    for (const trace of traces) {
      let searchableText = cache.get(trace.traceId);
      if (searchableText === void 0) {
        searchableText = buildSearchableText(trace);
        cache.set(trace.traceId, searchableText);
      }
      if (searchableText.includes(needle)) matches.push(trace.traceId);
    }
    return matches;
  }, [traces, query]);
}

export { MIN_QUERY_LENGTH };
