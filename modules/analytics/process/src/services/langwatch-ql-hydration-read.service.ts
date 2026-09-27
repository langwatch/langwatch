/**
 * Step 3: one read per key kind, tenant-scoped, chunked, stopped at a byte
 * budget. The row policy bounded the query, not this, so every read
 * re-establishes tenancy with the caller's own protections.
 * @see specs/lwql/app-functions.feature
 */

import {
  LangWatchQLAppFunctionHydrationFailedError,
  LangWatchQLAppFunctionReadBudgetError,
  type LangWatchQLProtections,
} from "@langwatch/analytics-contract";
import { HandledError } from "@langwatch/handled-error";
import type { Trace } from "@langwatch/trace-contract";

import { langWatchQLDistinctKeys } from "../rules/langwatch-ql-hydration-plan.rules.ts";
import type { LangWatchQLResolvedCall } from "../rules/langwatch-ql-hydration-plan.rules.ts";

/**
 * Keys per read call, sized so a chunk of large traces stays well inside the
 * budget — which is what lets the budget stop a read close to the line rather
 * than one enormous call past it.
 */
export const LWQL_HYDRATION_READ_CHUNK = {
  traceIds: 25,
  threadKeys: 10,
} as const;

/**
 * The traces one thread may bring back. The thread read's own default ceiling is
 * sized for one page of a list, so a chunk of conversations asks for its own.
 */
export const LWQL_TRACES_PER_THREAD_CEILING = 1_000;

/** What hydration needs from the Trace peer, and nothing more. */
/** Traces named by id, read with their spans. */
export type LangWatchQLTraceReadInput = {
  projectId: string;
  traceIds: readonly string[];
  protections: LangWatchQLProtections;
};

/** The named threads' traces, read with their spans. */
export type LangWatchQLThreadTraceReadInput = {
  projectId: string;
  threadKeys: readonly string[];
  protections: LangWatchQLProtections;
  /** The most traces the read may answer with, sized by the threads asked for. */
  maxTraces: number;
};

export interface LangWatchQLTraceSource {
  /** Traces named by id, with their spans. Order is not promised. */
  readTraces(input: LangWatchQLTraceReadInput): Promise<readonly Trace[]>;
  /**
   * Every trace of the named threads, with their spans. The thread key is the
   * conversation id after the fold, which the read maps back onto the trace's
   * own `metadata.thread_id`.
   */
  readThreadTraces(input: LangWatchQLThreadTraceReadInput): Promise<readonly Trace[]>;
}

/** Everything the reads brought back, indexed the way the compute reads it. */
export interface LangWatchQLFetchedTraces {
  readonly byId: ReadonlyMap<string, Trace>;
  readonly byThread: ReadonlyMap<string, readonly Trace[]>;
}

export const LWQL_NO_TRACES: LangWatchQLFetchedTraces = {
  byId: new Map(),
  byThread: new Map(),
};

/** The bytes one hydration has read so far, shared by every read it makes. */
interface ReadBudget {
  /** Fires, with the refusal as its reason, once the budget is passed. */
  readonly stopped: AbortSignal;
  /** Adds the traces' weight; throws the refusal once the budget is passed. */
  consume(input: { traces: readonly Trace[] }): void;
}

function createReadBudget({ maxBytes }: { maxBytes: number }): ReadBudget {
  let readBytes = 0;
  const stop = new AbortController();

  return {
    stopped: stop.signal,
    consume({ traces }) {
      for (const trace of traces) readBytes += Buffer.byteLength(JSON.stringify(trace));
      if (readBytes <= maxBytes) return;
      const refusal = new LangWatchQLAppFunctionReadBudgetError({
        budgetBytes: maxBytes,
        readBytes,
      });
      stop.abort(refusal);
      throw refusal;
    },
  };
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
}

/**
 * The thread read answers with every trace of every thread at once, so they are
 * grouped back. A trace whose key is not one we asked for is dropped: keeping
 * it would put content in a cell whose key never named it.
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

export class LangWatchQLHydrationReadService {
  private constructor(private readonly traces: LangWatchQLTraceSource) {}

  static create({ traces }: { traces: LangWatchQLTraceSource }): LangWatchQLHydrationReadService {
    return new LangWatchQLHydrationReadService(traces);
  }

  /**
   * One read per project per kind. The trace path filters on a single tenant,
   * so a key naming a trace in the second project a caller can read is only
   * found by asking that project.
   */
  async readTraces({
    projectIds,
    protections,
    resolved,
    maxReadBytes,
    signal,
  }: {
    projectIds: readonly string[];
    protections: LangWatchQLProtections;
    resolved: readonly LangWatchQLResolvedCall[];
    maxReadBytes: number;
    signal?: AbortSignal;
  }): Promise<LangWatchQLFetchedTraces> {
    const { traceIds, threadKeys } = langWatchQLDistinctKeys(resolved);
    const budget = createReadBudget({ maxBytes: maxReadBytes });
    // One signal over every read — the caller's cancel and the budget's own
    // refusal — so a chunk that crosses the line stops the sibling readers.
    const stop = signal ? AbortSignal.any([signal, budget.stopped]) : budget.stopped;

    try {
      const [byIdReads, byThreadReads] = await Promise.all([
        Promise.all(
          projectIds.map((projectId) =>
            this.#readInChunks({
              keys: [...traceIds],
              chunkSize: LWQL_HYDRATION_READ_CHUNK.traceIds,
              budget,
              signal: stop,
              read: (chunk) => this.traces.readTraces({ projectId, traceIds: chunk, protections }),
            }),
          ),
        ),
        Promise.all(
          projectIds.map((projectId) =>
            this.#readInChunks({
              keys: [...threadKeys],
              chunkSize: LWQL_HYDRATION_READ_CHUNK.threadKeys,
              budget,
              signal: stop,
              read: (chunk) =>
                this.traces.readThreadTraces({
                  projectId,
                  threadKeys: chunk,
                  protections,
                  maxTraces: chunk.length * LWQL_TRACES_PER_THREAD_CEILING,
                }),
            }),
          ),
        ),
      ]);

      return {
        byId: new Map(byIdReads.flat().map((trace) => [trace.trace_id, trace])),
        byThread: groupByThread({ traces: byThreadReads.flat(), threadKeys }),
      };
    } catch (error) {
      // A refusal we made and a cancellation the caller made are both answers;
      // only a read that broke is the platform's.
      if (error instanceof HandledError || signal?.aborted === true || isAbortError(error)) {
        throw error;
      }
      throw new LangWatchQLAppFunctionHydrationFailedError({
        reasons: [error instanceof Error ? error : new Error(String(error))],
      });
    }
  }

  /**
   * Reads the keys a chunk at a time, weighing each chunk against the shared
   * budget and answering a cancellation before the next chunk is asked for.
   */
  async #readInChunks({
    keys,
    chunkSize,
    budget,
    signal,
    read,
  }: {
    keys: readonly string[];
    chunkSize: number;
    budget: ReadBudget;
    signal: AbortSignal;
    read: (chunk: readonly string[]) => Promise<readonly Trace[]>;
  }): Promise<readonly Trace[]> {
    const traces: Trace[] = [];
    for (let start = 0; start < keys.length; start += chunkSize) {
      signal.throwIfAborted();
      const chunk = await read(keys.slice(start, start + chunkSize));
      budget.consume({ traces: chunk });
      traces.push(...chunk);
    }

    return traces;
  }
}
