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

async function resolveServerOnlyThreadValue({
  source,
  threadTraces,
}: {
  source: string;
  threadTraces: Trace[];
}): Promise<string> {
  if (source !== "formatted_traces") {
    // Unknown server-only source: degrade gracefully instead of crashing the evaluation loop
    return "";
  }
  return (
    await Promise.all(threadTraces.map((t) => formatSpansDigest(t.spans ?? [])))
  ).join("\n\n---\n\n");
}

async function resolveThreadField({
  data,
  targetField,
  mappingConfig,
  threadId,
  threadTraces,
}: {
  data: Record<string, unknown>;
  targetField: string;
  mappingConfig: MappingState["mapping"][string];
  threadId: string | null | undefined;
  threadTraces: Trace[];
}): Promise<void> {
  if (!("type" in mappingConfig && mappingConfig.type === "thread")) {
    return;
  }
  if (!("source" in mappingConfig) || !mappingConfig.source) {
    return;
  }

  const source = mappingConfig.source;

  if (!threadId) {
    // No thread_id: resolve to empty value
    data[targetField] = "";
    return;
  }

  if ((SERVER_ONLY_THREAD_SOURCES as readonly string[]).includes(source)) {
    data[targetField] = await resolveServerOnlyThreadValue({
      source,
      threadTraces,
    });
    return;
  }

  const threadSource = source as keyof typeof THREAD_MAPPINGS;
  const selectedFields =
    ("selectedFields" in mappingConfig
      ? mappingConfig.selectedFields
      : undefined) ?? [];
  data[targetField] = THREAD_MAPPINGS[threadSource].mapping(
    { thread_id: threadId, traces: threadTraces },
    selectedFields as (keyof typeof TRACE_MAPPINGS)[],
  );
}

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

  // Eagerly fetch thread traces once (empty if no thread_id)
  const threadTraces = threadId ? await getThreadTraces(threadId) : [];

  for (const [targetField, mappingConfig] of Object.entries(mappings.mapping)) {
    await resolveThreadField({
      data,
      targetField,
      mappingConfig,
      threadId,
      threadTraces,
    });
  }
}
