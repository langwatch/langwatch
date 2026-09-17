/**
 * Step 3 of the hydration stage: one read per key kind, tenant-scoped.
 *
 * The row policy bounded the query, not this. Every read goes through the
 * trace source with the caller's project and protections, so a key that came
 * back from the database cannot be used to read something the caller could not
 * have selected.
 *
 * @see ../traceSource.ts
 * @see ../hydrate.ts
 */

import type { Trace } from "~/server/tracer/types";
import { toError } from "~/utils/posthogErrorCapture";
import { LangWatchQLAppFunctionHydrationFailedError } from "../../errors";
import type { LangWatchQLHydrationInput, ResolvedCall } from "./contract";
import { distinctKeys } from "./keys";

// ---------------------------------------------------------------------------
// Step 3 — one read per kind
// ---------------------------------------------------------------------------

/** Everything the reads brought back, indexed the way the compute reads it. */
export interface FetchedTraces {
  readonly byId: ReadonlyMap<string, Trace>;
  readonly byThread: ReadonlyMap<string, readonly Trace[]>;
}

export async function readTraces({
  input,
  resolved,
}: {
  input: LangWatchQLHydrationInput;
  resolved: readonly ResolvedCall[];
}): Promise<FetchedTraces> {
  const { traceIds, threadKeys } = distinctKeys(resolved);

  try {
    const [byIdTraces, byThreadTraces] = await Promise.all([
      input.traceSource.tracesByIds({
        projectId: input.projectId,
        traceIds: [...traceIds],
        protections: input.protections,
      }),
      input.traceSource.tracesByThreadKeys({
        projectId: input.projectId,
        threadKeys: [...threadKeys],
        protections: input.protections,
      }),
    ]);
    return {
      byId: new Map(byIdTraces.map((trace) => [trace.trace_id, trace])),
      byThread: groupByThread({ traces: byThreadTraces, threadKeys }),
    };
  } catch (error) {
    throw new LangWatchQLAppFunctionHydrationFailedError({
      reasons: [toError(error)],
    });
  }
}

/**
 * The thread read answers with every trace of every requested thread at once,
 * so the traces are grouped back by the thread they belong to.
 *
 * `metadata.thread_id` is the grouping key: the read matched on
 * `Attributes['gen_ai.conversation.id']` and the trace mapper maps that same
 * attribute onto `thread_id`, so the two agree by construction. A trace whose
 * key is not one we asked for is dropped rather than grouped — it cannot
 * happen through the shipped read, and keeping it would put content in a cell
 * whose key never named it.
 */
function groupByThread({
  traces,
  threadKeys,
}: {
  traces: readonly Trace[];
  threadKeys: ReadonlySet<string>;
}): ReadonlyMap<string, readonly Trace[]> {
  const grouped = new Map<string, Trace[]>();
  for (const trace of traces) {
    const key = trace.metadata.thread_id;
    if (typeof key !== "string" || !threadKeys.has(key)) continue;
    const existing = grouped.get(key);
    if (existing) existing.push(trace);
    else grouped.set(key, [trace]);
  }
  return grouped;
}
