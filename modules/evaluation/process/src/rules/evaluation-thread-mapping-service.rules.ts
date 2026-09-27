/**
 * Shared module for resolving thread-typed mappings within evaluation data. Both the online
 * execution service and the background evaluations worker need identical logic to detect thread
 * mappings and resolve thread fields into an existing data record.
 */
import {
  type MappingState,
  SERVER_ONLY_THREAD_SOURCES,
  THREAD_MAPPINGS,
  type TRACE_MAPPINGS,
} from "@langwatch/dataset-contract";
import type { Trace } from "@langwatch/trace-contract";

import type { EvaluationSpanDigest } from "../app/evaluation.members.ts";

/**
 * Callback that fetches all traces belonging to a thread.
 * Callers provide their own implementation to decouple I/O from resolution logic.
 */
export type GetThreadTraces = (threadId: string) => Promise<Trace[]>;

/**
 * Check if any mapping in the state has type "thread".
 */
export function hasThreadMappings(mappingState: MappingState | null): boolean {
  // The `?.mapping` check defends against historical malformed rows persisted
  // before write-side coercion existed (#3875). The MappingState type says
  // `.mapping` is required, but legacy `{}` payloads in the DB violate that.
  if (!mappingState?.mapping) {
    return false;
  }

  return Object.values(mappingState.mapping).some(
    (mapping) => "type" in mapping && mapping.type === "thread",
  );
}

/**
 * Resolve thread-typed mappings and merge them into an existing data record. Used at trace
 * level when the mapping config contains a mix of trace and thread sources. Thread fields
 * that cannot be resolved (e.g. trace has no thread_id) default to empty values.
 */
export async function resolveThreadMappingsIntoData(params: {
  data: Record<string, unknown>;
  trace: Trace;
  mappings: MappingState;
  getThreadTraces: GetThreadTraces;
  spanDigest: EvaluationSpanDigest;
}): Promise<void> {
  const { data, trace, mappings, getThreadTraces, spanDigest } = params;
  const threadId = trace.metadata?.thread_id;

  // Eagerly fetch thread traces once (empty if no thread_id)
  const threadTraces = threadId ? await getThreadTraces(threadId) : [];

  for (const [targetField, mappingConfig] of Object.entries(mappings.mapping)) {
    const outcome = await resolveThreadField({ mappingConfig, threadId, threadTraces, spanDigest });
    if (outcome.resolved) data[targetField] = outcome.value;
  }
}

type ThreadFieldOutcome = { resolved: true; value: unknown } | { resolved: false };

async function resolveThreadField({
  mappingConfig,
  threadId,
  threadTraces,
  spanDigest,
}: {
  mappingConfig: MappingState["mapping"][string];
  threadId: string | null | undefined;
  threadTraces: Awaited<ReturnType<GetThreadTraces>>;
  spanDigest: EvaluationSpanDigest;
}): Promise<ThreadFieldOutcome> {
  if (!("type" in mappingConfig && mappingConfig.type === "thread")) return { resolved: false };
  if (!("source" in mappingConfig) || !mappingConfig.source) return { resolved: false };

  const source = mappingConfig.source;

  // No thread_id: resolve to empty value
  if (!threadId) return { resolved: true, value: "" };

  if ((SERVER_ONLY_THREAD_SOURCES as readonly string[]).includes(source)) {
    // Unknown server-only source: degrade gracefully instead of crashing the evaluation loop
    if (source !== "formatted_traces") return { resolved: true, value: "" };

    const formatted = await Promise.all(threadTraces.map((t) => spanDigest.format(t.spans ?? [])));
    return { resolved: true, value: formatted.join("\n\n---\n\n") };
  }

  const threadSource = source as keyof typeof THREAD_MAPPINGS;
  const selectedFields =
    ("selectedFields" in mappingConfig ? mappingConfig.selectedFields : undefined) ?? [];
  return {
    resolved: true,
    value: THREAD_MAPPINGS[threadSource].mapping(
      { thread_id: threadId, traces: threadTraces },
      selectedFields as (keyof typeof TRACE_MAPPINGS)[],
    ),
  };
}
