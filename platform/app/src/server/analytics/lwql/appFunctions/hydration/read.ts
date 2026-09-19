/**
 * Step 3 of the hydration stage: one read per key kind, tenant-scoped,
 * chunked, and stopped at a byte budget.
 *
 * The row policy bounded the query, not this. Every read goes through the
 * trace source with the caller's projects and protections, so a key that came
 * back from the database cannot be used to read something the caller could not
 * have selected.
 *
 * The keys are read in chunks rather than in one call, for two reasons that
 * share a cause. The key cap bounds how many traces a page names, not what
 * they weigh, so a page under the cap can still name gigabytes of stored
 * content; reading it all before the result ceiling drops the rows would hold
 * every trace in memory first. So each chunk is weighed as it lands and the
 * read stops at the budget with a refusal. And a caller that cancels while the
 * reads are under way is answered between chunks, not after the last one.
 *
 * @see ../traceSource.ts
 * @see ../hydrate.ts
 */

import { HandledError } from "@langwatch/handled-error";

import type { Trace } from "~/server/tracer/types";
import { toError } from "~/utils/posthogErrorCapture";
import {
  LangWatchQLAppFunctionHydrationFailedError,
  LangWatchQLAppFunctionReadBudgetError,
} from "../../errors";
import type { LangWatchQLHydrationInput, ResolvedCall } from "./contract";
import { distinctKeys } from "./keys";

/**
 * Bytes one hydration may read before it is refused.
 *
 * Four times the hydrated result ceiling: the per-value cut and the result
 * ceiling both trim what is *returned*, and a read that could not fetch a
 * few times more than the result may carry would refuse queries the ceilings
 * would have answered.
 */
export const LWQL_APP_FUNCTION_READ_BYTES_BUDGET = 128_000_000;

/**
 * Keys per read call. Sized so a chunk of large traces stays well inside the
 * budget, which is what lets the budget stop a read close to the line rather
 * than one enormous call past it.
 */
export const LWQL_APP_FUNCTION_READ_CHUNK = {
  traceIds: 25,
  threadKeys: 10,
} as const;

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
  const budget = createReadBudget({
    maxBytes: input.limits.maxReadBytes ?? LWQL_APP_FUNCTION_READ_BYTES_BUDGET,
  });

  try {
    // One read per project per kind. The trace path filters on a single
    // tenant, so a key that names a trace in the second project a caller can
    // read is only found by asking that project — and asking them all is what
    // keeps a multi-project result from hydrating its first project's rows and
    // reporting the rest as unresolved.
    const [byIdReads, byThreadReads] = await Promise.all([
      Promise.all(
        input.projectIds.map((projectId) =>
          readInChunks({
            keys: [...traceIds],
            chunkSize: LWQL_APP_FUNCTION_READ_CHUNK.traceIds,
            budget,
            signal: input.signal,
            read: (chunk) =>
              input.traceSource.tracesByIds({
                projectId,
                traceIds: chunk,
                protections: input.protections,
              }),
          }),
        ),
      ),
      Promise.all(
        input.projectIds.map((projectId) =>
          readInChunks({
            keys: [...threadKeys],
            chunkSize: LWQL_APP_FUNCTION_READ_CHUNK.threadKeys,
            budget,
            signal: input.signal,
            read: (chunk) =>
              input.traceSource.tracesByThreadKeys({
                projectId,
                threadKeys: chunk,
                protections: input.protections,
              }),
          }),
        ),
      ),
    ]);
    const byIdTraces = byIdReads.flat();
    const byThreadTraces = byThreadReads.flat();
    return {
      byId: new Map(byIdTraces.map((trace) => [trace.trace_id, trace])),
      byThread: groupByThread({ traces: byThreadTraces, threadKeys }),
    };
  } catch (error) {
    // A refusal we made and a cancellation the caller made are both answers,
    // not read failures; only a read that broke is the platform's.
    if (
      error instanceof HandledError ||
      input.signal?.aborted ||
      isAbortError(error)
    ) {
      throw error;
    }
    throw new LangWatchQLAppFunctionHydrationFailedError({
      reasons: [toError(error)],
    });
  }
}

/** The bytes one hydration has read so far, shared by every read it makes. */
interface ReadBudget {
  readonly maxBytes: number;
  /** Adds the traces' weight; throws the refusal once the budget is passed. */
  consume(input: { traces: readonly Trace[] }): void;
}

function createReadBudget({ maxBytes }: { maxBytes: number }): ReadBudget {
  let readBytes = 0;
  return {
    maxBytes,
    consume({ traces }) {
      for (const trace of traces) {
        readBytes += Buffer.byteLength(JSON.stringify(trace));
      }
      if (readBytes > maxBytes) {
        throw new LangWatchQLAppFunctionReadBudgetError({
          budgetBytes: maxBytes,
          readBytes,
        });
      }
    },
  };
}

/**
 * Reads the keys a chunk at a time, weighing each chunk against the shared
 * budget and answering a cancellation before the next chunk is asked for.
 */
async function readInChunks({
  keys,
  chunkSize,
  budget,
  signal,
  read,
}: {
  keys: readonly string[];
  chunkSize: number;
  budget: ReadBudget;
  signal: AbortSignal | undefined;
  read: (chunk: readonly string[]) => Promise<Trace[]>;
}): Promise<Trace[]> {
  const traces: Trace[] = [];
  for (let start = 0; start < keys.length; start += chunkSize) {
    signal?.throwIfAborted();
    const chunk = await read(keys.slice(start, start + chunkSize));
    budget.consume({ traces: chunk });
    traces.push(...chunk);
  }
  return traces;
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "AbortError" || error.name === "TimeoutError")
  );
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
