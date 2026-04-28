import { useMemo, useRef } from "react";
import type { TraceListItem } from "../../types/trace";

const MIN_QUERY_LENGTH = 2;

function buildSearchableText(trace: TraceListItem): string {
  const evaluationText = trace.evaluations
    .map((e) => `${e.evaluatorName ?? ""} ${e.label ?? ""}`)
    .join(" ");
  const eventText = trace.events.map((e) => e.name).join(" ");

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
    trace.rootSpanName,
    trace.models.join(" "),
    evaluationText,
    eventText,
  ]
    .filter((v): v is string => typeof v === "string" && v.length > 0)
    .join(" ")
    .toLowerCase();
}

export function useTraceSearchIndex({
  traces,
  query,
}: {
  traces: TraceListItem[];
  query: string;
}): string[] {
  const cacheRef = useRef<{
    traces: TraceListItem[];
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
      let text = cache.get(trace.traceId);
      if (text === undefined) {
        text = buildSearchableText(trace);
        cache.set(trace.traceId, text);
      }
      if (text.includes(needle)) matches.push(trace.traceId);
    }
    return matches;
  }, [traces, query]);
}

export { MIN_QUERY_LENGTH };
