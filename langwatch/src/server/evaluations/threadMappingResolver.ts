/**
 * Shared module for resolving thread-typed mappings within evaluation data.
 *
 * Both the app-layer EvaluationExecutionService and the background evaluationsWorker
 * need identical logic to detect thread mappings and resolve thread fields into
 * an existing data record. The I/O concern (how to fetch thread traces) is injected
 * via a `getThreadTraces` callback, following the Dependency Inversion principle.
 */
import { formatSpansDigest } from "~/server/tracer/spanToReadableSpan";
import {
  type MappingState,
  SERVER_ONLY_THREAD_SOURCES,
  THREAD_MAPPINGS,
  type TRACE_MAPPINGS,
} from "~/server/tracer/tracesMapping";
import type { Trace } from "~/server/tracer/types";

/**
 * Check if any mapping in the state has type "thread".
 */
export function hasThreadMappings(
  mappingState: MappingState | null,
): boolean {
  if (!mappingState) return false;
  return Object.values(mappingState.mapping).some(
    (mapping) => "type" in mapping && mapping.type === "thread",
  );
}

/**
 * Callback that fetches all traces belonging to a thread.
 * Callers provide their own implementation to decouple I/O from resolution logic.
 */
export type GetThreadTraces = (threadId: string) => Promise<Trace[]>;

/**
 * Resolve thread-typed mappings and merge them into an existing data record.
 *
 * Used at trace level when the mapping config contains a mix of trace and thread
 * sources. Thread fields that cannot be resolved (e.g. trace has no thread_id)
 * default to empty values.
 */
export async function resolveThreadMappingsIntoData(params: {
  data: Record<string, unknown>;
  trace: Trace;
  mappings: MappingState;
  getThreadTraces: GetThreadTraces;
}): Promise<void> {
  const { data, trace, mappings, getThreadTraces } = params;
  const threadId = trace.metadata?.thread_id;

  // Lazily fetch thread traces only once (if needed)
  let threadTraces: Trace[] | null = null;
  const fetchOnce = async (): Promise<Trace[]> => {
    if (threadTraces !== null) return threadTraces;
    if (!threadId) {
      threadTraces = [];
      return threadTraces;
    }
    threadTraces = await getThreadTraces(threadId);
    return threadTraces;
  };

  for (const [targetField, mappingConfig] of Object.entries(
    mappings.mapping,
  )) {
    if (!("type" in mappingConfig && mappingConfig.type === "thread")) {
      continue;
    }
    if (!("source" in mappingConfig) || !mappingConfig.source) {
      continue;
    }

    const source = mappingConfig.source;

    if (!threadId) {
      // No thread_id: resolve to empty value
      data[targetField] = "";
      continue;
    }

    const traces = await fetchOnce();

    if (
      (SERVER_ONLY_THREAD_SOURCES as readonly string[]).includes(source)
    ) {
      if (source === "formatted_traces") {
        data[targetField] = (
          await Promise.all(
            traces.map((t) => formatSpansDigest(t.spans ?? [])),
          )
        ).join("\n\n---\n\n");
      }
    } else {
      const threadSource = source as keyof typeof THREAD_MAPPINGS;
      const selectedFields =
        ("selectedFields" in mappingConfig
          ? mappingConfig.selectedFields
          : undefined) ?? [];
      data[targetField] = THREAD_MAPPINGS[threadSource].mapping(
        { thread_id: threadId, traces },
        selectedFields as (keyof typeof TRACE_MAPPINGS)[],
      );
    }
  }
}
