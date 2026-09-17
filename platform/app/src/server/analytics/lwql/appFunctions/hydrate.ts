/**
 * LangWatchQL app functions — the stage that runs after the query.
 *
 * The database answered with keys; this turns them into values. Four steps, in
 * an order that is load-bearing:
 *
 *  1. **Collect the distinct keys**, per call and per kind. Distinct, because a
 *     query grouping ten thousand rows onto two hundred conversations costs two
 *     hundred reads, not ten thousand.
 *  2. **Check the caps**, before any fetch. A cap breach is a refusal
 *     (`lwql_app_function_key_cap`) rather than a partial answer: a result that
 *     silently hydrated the first thousand keys and left the rest as raw ids
 *     would look complete and be wrong, which is the one failure an analytics
 *     caller cannot detect.
 *  3. **Fetch once per kind**, through the tenant-scoped trace services with
 *     the caller's own protections (`./traceSource.ts`), so three functions over
 *     the same rows share one read.
 *  4. **Compute once per distinct key**, overwrite the cell, and re-declare the
 *     column's type — the column held `Nullable(String)` because that is what
 *     the key was, and the value is not the same thing.
 *
 * Everything the caller has to be told is reported rather than hidden: a value
 * cut at the per-value ceiling, a key that resolved to nothing, and rows dropped
 * at the hydrated-bytes ceiling all leave a diagnostic behind.
 *
 * ## Why tenancy is re-established here
 *
 * The row policy bounded the query. It did not bound *this*: the keys came back
 * to the application, and a fetch that took them at face value would read
 * whichever trace they named. Every read goes through `./traceSource.ts`, which
 * takes the project and the protections. There is no ClickHouse query in this
 * module.
 *
 * @see ./catalog.ts — what each function is
 * @see ../../../../../specs/analytics/lwql-app-functions.feature
 */

import type { Trace } from "~/server/tracer/types";
import type { Protections } from "~/server/traces/protections";
import { cutToEstimatedTokens } from "~/shared/traces/tokenBudget";
import { toError } from "~/utils/posthogErrorCapture";
import {
  LangWatchQLAppFunctionHydrationFailedError,
  LangWatchQLAppFunctionKeyCapError,
} from "../errors";
import type { LangWatchQLColumn } from "../executor";
import {
  type LangWatchQLAppFunctionDefinition,
  type LangWatchQLAppFunctionKeyKind,
  LWQL_APP_FUNCTION_KEY_CAPS,
  lwqlAppFunction,
} from "./catalog";
import { renderThreadConversation, threadTraceIds } from "./conversation";
import { appFunctionKeyId, appFunctionKeyParts } from "./keys";
import type { LangWatchQLAppFunctionCall } from "./plan";
import type { LangWatchQLAppFunctionTraceSource } from "./traceSource";
import {
  type LlmMessagesSide,
  renderReadableTrace,
  renderSpanMessages,
  renderTraceJson,
  renderTraceMessages,
} from "./traceValues";

/** How much hydrated content one response may carry. */
export interface LangWatchQLHydrationLimits {
  /**
   * Byte budget for the whole hydrated result. Trailing rows are dropped past
   * it and the result says so.
   *
   * Separate from the executor's `maxResultBytes`, which bounded the rows the
   * *database* returned — a page of keys, which is small by construction. This
   * bounds what the application then put in them, which is the number that can
   * run to megabytes per row.
   */
  readonly maxHydratedBytes: number;
  /**
   * Byte ceiling for one value. A value past it is cut on a UTF-8 boundary and
   * reported, rather than the whole row being dropped: one enormous trace in a
   * page of a hundred should cost that one cell, not the ninety-nine others.
   */
  readonly maxHydratedValueBytes: number;
}

/** One call's values that were cut at the per-value ceiling. */
export interface LangWatchQLValueTruncation {
  readonly column: string;
  readonly function: string;
  readonly values: number;
}

/** One call's keys that named nothing. */
export interface LangWatchQLUnresolvedKeys {
  readonly column: string;
  readonly function: string;
  readonly keys: number;
}

export interface LangWatchQLHydrationInput {
  /** Logged and passed to the trace reads; the reads filter on it. */
  readonly projectId: string;
  /** Resolved server-side from the authenticated context, never the request. */
  readonly protections: Protections;
  /** The plan the validator's walk recorded. Empty means nothing to do. */
  readonly calls: readonly LangWatchQLAppFunctionCall[];
  readonly columns: readonly LangWatchQLColumn[];
  readonly rows: readonly Record<string, unknown>[];
  readonly limits: LangWatchQLHydrationLimits;
  readonly traceSource: LangWatchQLAppFunctionTraceSource;
}

export interface LangWatchQLHydrationResult {
  readonly columns: readonly LangWatchQLColumn[];
  readonly rows: readonly Record<string, unknown>[];
  /** Whether the hydrated-bytes ceiling dropped trailing rows. */
  readonly truncatedByBytes: boolean;
  readonly valueTruncations: readonly LangWatchQLValueTruncation[];
  readonly unresolvedKeys: readonly LangWatchQLUnresolvedKeys[];
}

/** A call, with the catalog entry it names. */
interface ResolvedCall {
  readonly call: LangWatchQLAppFunctionCall;
  readonly definition: LangWatchQLAppFunctionDefinition;
  /** Distinct keys this call needs, keyed by {@link appFunctionKeyId}. */
  readonly keys: Map<string, readonly string[]>;
}

/** One computed value, and whether the per-value ceiling cut it. */
interface ComputedValue {
  readonly value: string | readonly string[] | null;
  readonly truncated: boolean;
  /** False when the key named no trace or thread at all. */
  readonly resolved: boolean;
}

const NOT_RESOLVED: ComputedValue = {
  value: null,
  truncated: false,
  resolved: false,
};

/**
 * Replaces every app-function key in a finished result with the value it names.
 *
 * Returns the result unchanged, and reads nothing, when the statement called no
 * app function — which is every LangWatchQL query that existed before this
 * feature.
 *
 * @throws {LangWatchQLAppFunctionKeyCapError} when one execution needs more
 *   distinct keys of a kind than its cap allows.
 * @throws {LangWatchQLAppFunctionHydrationFailedError} when a read or a
 *   computation fails. Deliberately a platform fault: nothing the caller wrote
 *   is wrong, and a wrong answer is not on offer.
 */
export async function hydrateLangWatchQLAppFunctions(
  input: LangWatchQLHydrationInput,
): Promise<LangWatchQLHydrationResult> {
  if (input.calls.length === 0) {
    return {
      columns: input.columns,
      rows: input.rows,
      truncatedByBytes: false,
      valueTruncations: [],
      unresolvedKeys: [],
    };
  }

  const resolved = collectKeys(input);
  assertKeyCaps(resolved);

  const traces = await readTraces({ input, resolved });
  const computed = await computeValues({ input, resolved, traces });

  return assembleResult({ input, resolved, computed });
}

// ---------------------------------------------------------------------------
// Step 1 — the distinct keys each call needs
// ---------------------------------------------------------------------------

function collectKeys({
  calls,
  rows,
}: Pick<LangWatchQLHydrationInput, "calls" | "rows">): ResolvedCall[] {
  return calls.map((call) => {
    const definition = lwqlAppFunction(call.function);
    if (!definition) {
      // Not a customer-facing condition: the validator only admits names from
      // this same catalog, so a plan naming something else is our bug and must
      // degrade to "unknown" rather than wear a handled code (ADR-045).
      throw new Error(
        `lwql hydration: the plan names "${call.function}", which is not an app function`,
      );
    }
    const keys = new Map<string, readonly string[]>();
    for (const row of rows) {
      const parts = appFunctionKeyParts(row[call.column]);
      if (!parts) continue;
      keys.set(appFunctionKeyId(parts), parts);
    }
    return { call, definition, keys };
  });
}

// ---------------------------------------------------------------------------
// Step 2 — the caps, before anything is read
// ---------------------------------------------------------------------------

/**
 * The distinct keys of each kind this execution needs.
 *
 * Counted across every call rather than per call, because the fetch is shared:
 * three functions over one set of trace ids is one read of that set, and
 * charging each of them separately against the cap would refuse a query that
 * costs no more than a single-function one. The span kind contributes its trace
 * ids to the trace count as well, since resolving a span means reading its
 * trace.
 */
function distinctKeyCounts(
  resolved: readonly ResolvedCall[],
): Record<LangWatchQLAppFunctionKeyKind, number> {
  const traceIds = new Set<string>();
  const threadKeys = new Set<string>();
  const spanPairs = new Set<string>();
  for (const { definition, keys } of resolved) {
    for (const [keyId, parts] of keys) {
      const [first] = parts;
      if (first === undefined) continue;
      if (definition.keyKind === "thread") threadKeys.add(first);
      else traceIds.add(first);
      if (definition.keyKind === "span") spanPairs.add(keyId);
    }
  }
  return {
    trace: traceIds.size,
    thread: threadKeys.size,
    span: spanPairs.size,
  };
}

function assertKeyCaps(resolved: readonly ResolvedCall[]): void {
  const counts = distinctKeyCounts(resolved);
  for (const [keyKind, cap] of Object.entries(LWQL_APP_FUNCTION_KEY_CAPS) as [
    LangWatchQLAppFunctionKeyKind,
    number,
  ][]) {
    const distinct = counts[keyKind];
    if (distinct <= cap) continue;
    throw new LangWatchQLAppFunctionKeyCapError({
      keyKind,
      cap,
      distinct,
      functions: resolved
        .filter((entry) => entry.definition.keyKind === keyKind)
        .map((entry) => entry.definition.name),
    });
  }
}

// ---------------------------------------------------------------------------
// Step 3 — one read per kind
// ---------------------------------------------------------------------------

/** Everything the reads brought back, indexed the way the compute reads it. */
interface FetchedTraces {
  readonly byId: ReadonlyMap<string, Trace>;
  readonly byThread: ReadonlyMap<string, readonly Trace[]>;
}

async function readTraces({
  input,
  resolved,
}: {
  input: LangWatchQLHydrationInput;
  resolved: readonly ResolvedCall[];
}): Promise<FetchedTraces> {
  const traceIds = new Set<string>();
  const threadKeys = new Set<string>();
  for (const { definition, keys } of resolved) {
    for (const parts of keys.values()) {
      const [first] = parts;
      if (first === undefined) continue;
      if (definition.keyKind === "thread") threadKeys.add(first);
      else traceIds.add(first);
    }
  }

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

// ---------------------------------------------------------------------------
// Step 4 — compute once per distinct key
// ---------------------------------------------------------------------------

/** The computed values, per call column, per key. */
type ComputedValues = ReadonlyMap<string, ReadonlyMap<string, ComputedValue>>;

async function computeValues({
  input,
  resolved,
  traces,
}: {
  input: LangWatchQLHydrationInput;
  resolved: readonly ResolvedCall[];
  traces: FetchedTraces;
}): Promise<ComputedValues> {
  const computed = new Map<string, Map<string, ComputedValue>>();
  try {
    for (const entry of resolved) {
      const perKey = new Map<string, ComputedValue>();
      for (const [keyId, parts] of entry.keys) {
        perKey.set(
          keyId,
          capValue({
            computed: await computeOne({ entry, parts, traces }),
            maxBytes: input.limits.maxHydratedValueBytes,
          }),
        );
      }
      computed.set(entry.call.column, perKey);
    }
  } catch (error) {
    throw new LangWatchQLAppFunctionHydrationFailedError({
      reasons: [toError(error)],
    });
  }
  return computed;
}

/** One key's value, for one call. */
async function computeOne({
  entry,
  parts,
  traces,
}: {
  entry: ResolvedCall;
  parts: readonly string[];
  traces: FetchedTraces;
}): Promise<ComputedValue> {
  const [first, second] = parts;
  if (first === undefined) return NOT_RESOLVED;

  if (entry.definition.keyKind === "thread") {
    return computeThreadValue({
      entry,
      threadKey: first,
      threadTraces: traces.byThread.get(first) ?? [],
    });
  }

  const trace = traces.byId.get(first);
  if (!trace) return NOT_RESOLVED;
  return await computeTraceValue({ entry, trace, spanId: second });
}

function computeThreadValue({
  entry,
  threadKey,
  threadTraces,
}: {
  entry: ResolvedCall;
  threadKey: string;
  threadTraces: readonly Trace[];
}): ComputedValue {
  if (threadTraces.length === 0) return NOT_RESOLVED;
  const { name } = entry.definition;

  if (name === "thread_traces") {
    return {
      value: threadTraceIds({ traces: threadTraces }),
      truncated: false,
      resolved: true,
    };
  }

  const rendered = renderThreadConversation({
    threadKey,
    traces: threadTraces,
    ...(name === "conversation_bounded"
      ? {
          maxTokens: numberOption({ entry, at: 0 }),
          untilTraceId: stringOption({ entry, at: 1 }),
        }
      : {}),
  });
  return { value: rendered.text, truncated: false, resolved: true };
}

/** The `side` each messages function answers with. */
const MESSAGES_SIDES: Readonly<Record<string, LlmMessagesSide>> = {
  llm_messages: "both",
  llm_input_messages: "input",
  llm_output_messages: "output",
};

async function computeTraceValue({
  entry,
  trace,
  spanId,
}: {
  entry: ResolvedCall;
  trace: Trace;
  spanId: string | undefined;
}): Promise<ComputedValue> {
  const { name } = entry.definition;

  if (name === "llm_readable_trace") {
    const rendered = await renderReadableTrace({
      trace,
      maxTokens: numberOption({ entry, at: 0 }),
    });
    return { value: rendered.text, truncated: false, resolved: true };
  }

  if (name === "llm_messages_span") {
    return {
      value:
        spanId === undefined ? null : renderSpanMessages({ trace, spanId }),
      truncated: false,
      resolved: true,
    };
  }

  if (name === "trace_json") {
    return {
      value: renderTraceJson({ trace }),
      truncated: false,
      resolved: true,
    };
  }

  const side = MESSAGES_SIDES[name];
  if (side === undefined) {
    throw new Error(
      `lwql hydration: no compute is wired for the app function "${name}"`,
    );
  }
  return {
    value: renderTraceMessages({ trace, side }),
    truncated: false,
    resolved: true,
  };
}

/**
 * An option the validator already proved is a literal of the declared type.
 *
 * Re-checked anyway, and loudly: the plan is built by one module and read by
 * another, and a mismatch would otherwise reach a renderer as `NaN` and produce
 * a plausible-looking wrong budget.
 */
function numberOption({
  entry,
  at,
}: {
  entry: ResolvedCall;
  at: number;
}): number {
  const option = entry.call.options[at];
  if (typeof option !== "number" || !Number.isFinite(option)) {
    throw new Error(
      `lwql hydration: "${entry.definition.name}" needs a numeric option at position ${at}`,
    );
  }
  return option;
}

function stringOption({
  entry,
  at,
}: {
  entry: ResolvedCall;
  at: number;
}): string {
  const option = entry.call.options[at];
  if (typeof option !== "string") {
    throw new Error(
      `lwql hydration: "${entry.definition.name}" needs a string option at position ${at}`,
    );
  }
  return option;
}

/**
 * Cuts one value to the per-value ceiling.
 *
 * Only a string value is cut. The one list-valued function returns a thread's
 * trace ids, which the thread read itself bounds at a thousand — tens of
 * kilobytes, orders of magnitude under the ceiling — so a cut there would be
 * dead code pretending to be a safeguard.
 *
 * The cut goes through the shared token cutter at a quarter of the byte budget,
 * which is exactly a byte cut on a UTF-8 boundary: a cut landing mid-character
 * would otherwise ship a replacement character.
 */
function capValue({
  computed,
  maxBytes,
}: {
  computed: ComputedValue;
  maxBytes: number;
}): ComputedValue {
  const { value } = computed;
  if (typeof value !== "string") return computed;
  if (new TextEncoder().encode(value).length <= maxBytes) return computed;
  return {
    ...computed,
    value: cutToEstimatedTokens({
      text: value,
      maxTokens: Math.floor(maxBytes / 4),
    }),
    truncated: true,
  };
}

// ---------------------------------------------------------------------------
// Assembling the answer
// ---------------------------------------------------------------------------

function assembleResult({
  input,
  resolved,
  computed,
}: {
  input: LangWatchQLHydrationInput;
  resolved: readonly ResolvedCall[];
  computed: ComputedValues;
}): LangWatchQLHydrationResult {
  const hydrated = input.rows.map((row) => {
    const next: Record<string, unknown> = { ...row };
    for (const entry of resolved) {
      const parts = appFunctionKeyParts(row[entry.call.column]);
      const value =
        parts === null
          ? null
          : (computed.get(entry.call.column)?.get(appFunctionKeyId(parts))
              ?.value ?? null);
      next[entry.call.column] = value;
    }
    return next;
  });

  const { rows, truncatedByBytes } = applyHydratedByteCeiling({
    rows: hydrated,
    maxHydratedBytes: input.limits.maxHydratedBytes,
  });

  return {
    columns: retypeColumns({ columns: input.columns, resolved }),
    rows,
    truncatedByBytes,
    valueTruncations: resolved
      .map((entry) => ({
        column: entry.call.column,
        function: entry.definition.name,
        values: countWhere({ computed, entry, predicate: (v) => v.truncated }),
      }))
      .filter((report) => report.values > 0),
    unresolvedKeys: resolved
      .map((entry) => ({
        column: entry.call.column,
        function: entry.definition.name,
        keys: countWhere({ computed, entry, predicate: (v) => !v.resolved }),
      }))
      .filter((report) => report.keys > 0),
  };
}

function countWhere({
  computed,
  entry,
  predicate,
}: {
  computed: ComputedValues;
  entry: ResolvedCall;
  predicate: (value: ComputedValue) => boolean;
}): number {
  const perKey = computed.get(entry.call.column);
  if (!perKey) return 0;
  let count = 0;
  for (const value of perKey.values()) if (predicate(value)) count += 1;
  return count;
}

/**
 * Drops trailing rows past the hydrated-bytes ceiling.
 *
 * Trailing rather than largest-first: the caller wrote the `ORDER BY`, so the
 * rows that survive are a prefix of the answer they asked for, which is a
 * result they can page past. Dropping the biggest rows instead would hand back
 * a set with holes in it that nothing in the response could describe.
 */
function applyHydratedByteCeiling({
  rows,
  maxHydratedBytes,
}: {
  rows: readonly Record<string, unknown>[];
  maxHydratedBytes: number;
}): { rows: Record<string, unknown>[]; truncatedByBytes: boolean } {
  const kept: Record<string, unknown>[] = [];
  let bytes = 0;
  for (const row of rows) {
    bytes += JSON.stringify(row)?.length ?? 0;
    if (bytes > maxHydratedBytes) {
      return { rows: kept, truncatedByBytes: true };
    }
    kept.push(row);
  }
  return { rows: kept, truncatedByBytes: false };
}

/**
 * Re-declares each hydrated column with the type its value actually has.
 *
 * The server typed the column after the key — `Nullable(String)` for a
 * conversation id — and leaving that in place would tell a consumer the column
 * holds an id. A column the result did not carry at all is left alone rather
 * than invented: hydration describes what came back, and cannot add a column
 * the database never returned.
 */
function retypeColumns({
  columns,
  resolved,
}: {
  columns: readonly LangWatchQLColumn[];
  resolved: readonly ResolvedCall[];
}): readonly LangWatchQLColumn[] {
  const byColumn = new Map(
    resolved.map((entry) => [entry.call.column, entry.definition.returns]),
  );
  return columns.map((column) => {
    const type = byColumn.get(column.name);
    return type === undefined ? column : { ...column, type };
  });
}
