/**
 * Shared module for resolving thread-typed mappings within evaluation data.
 *
 * Both the online execution service and the background evaluations worker
 * need identical logic to detect thread mappings and resolve thread fields into
 * an existing data record. The I/O concern (how to fetch thread traces) is injected
 * via a `getThreadTraces` callback, following the Dependency Inversion principle.
 */
import {
  type MappingState,
  SERVER_ONLY_THREAD_SOURCES,
  THREAD_MAPPINGS,
  type TRACE_MAPPINGS,
  type Trace,
} from "@langwatch/trace-contract";
import type { EvaluationSpanDigestPort } from "../ports/evaluation-execution.port";

/**
 * Check if any mapping in the state has type "thread".
 */
export function hasThreadMappings(mappingState: MappingState | null): boolean {
  // The `?.mapping` check defends against historical malformed rows persisted
  // before write-side coercion existed (#3875). The MappingState type says
  // `.mapping` is required, but legacy `{}` payloads in the DB violate that.
  if (!mappingState?.mapping) return false;
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
  spanDigest: EvaluationSpanDigestPort;
}): Promise<void> {
  const { data, trace, mappings, getThreadTraces, spanDigest } = params;
  const threadId = trace.metadata?.thread_id;

  // Eagerly fetch thread traces once (empty if no thread_id)
  const threadTraces = threadId ? await getThreadTraces(threadId) : [];

  for (const [targetField, mappingConfig] of Object.entries(mappings.mapping)) {
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

    const traces = threadTraces;

    if ((SERVER_ONLY_THREAD_SOURCES as readonly string[]).includes(source)) {
      if (source === "formatted_traces") {
        data[targetField] = (
          await Promise.all(traces.map((t) => spanDigest.format(t.spans ?? [])))
        ).join("\n\n---\n\n");
      } else {
        // Unknown server-only source: degrade gracefully instead of crashing the evaluation loop
        data[targetField] = "";
      }
    } else {
      const threadSource = source as keyof typeof THREAD_MAPPINGS;
      const selectedFields =
        ("selectedFields" in mappingConfig ? mappingConfig.selectedFields : undefined) ?? [];
      data[targetField] = THREAD_MAPPINGS[threadSource].mapping(
        { thread_id: threadId, traces },
        selectedFields as (keyof typeof TRACE_MAPPINGS)[],
      );
    }
  }
}
