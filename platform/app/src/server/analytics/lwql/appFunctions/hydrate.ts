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
 * @see ../../../../../specs/lwql/app-functions.feature
 */

import { InstantEvalClassifierUnavailableError } from "~/server/app-layer/instant-evals/errors";
import { assembleResult } from "./hydration/assemble";
import { computeValues } from "./hydration/compute";
import type {
  ComputedValue,
  ComputedValues,
  LangWatchQLEvalUsage,
  LangWatchQLHydrationInput,
  LangWatchQLHydrationResult,
  LangWatchQLHydrationTimings,
  ResolvedCall,
} from "./hydration/contract";
import {
  ClassifierAnsweredNothingError,
  evaluateCalls,
} from "./hydration/evaluate";
import { assertKeyCaps, collectKeys } from "./hydration/keys";
import { type FetchedTraces, readTraces } from "./hydration/read";

/**
 * Replaces every app-function key in a finished result with the value it names.
 *
 * Returns the result unchanged, and reads nothing, when the statement called no
 * app function — which is every LangWatchQL query that existed before this
 * feature.
 *
 * The two halves are also published on their own, {@link prepareLangWatchQLHydration}
 * and {@link judgeLangWatchQLHydration}, so a caller that judges page after
 * page can read the next page while the current one is being judged.
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
  return await judgeLangWatchQLHydration({
    prepared: await prepareLangWatchQLHydration(input),
  });
}

/**
 * Everything a hydration has read and extracted, and has not yet judged.
 *
 * The read half of the stage is the database and the trace store; the judge
 * half is the classifier. Splitting them is what lets a page loop overlap one
 * page's reads with the previous page's judging, which are bound by different
 * services and do not contend.
 */
export interface LangWatchQLPreparedHydration {
  readonly input: LangWatchQLHydrationInput;
  readonly resolved: readonly ResolvedCall[];
  readonly traces: FetchedTraces;
  /** The extraction functions' values, computed; the judged columns are not here. */
  readonly extracted: ComputedValues;
  /** What the read half spent, which the judged result reports as its own. */
  readonly timings: Omit<LangWatchQLHydrationTimings, "judgeMs">;
}

/**
 * Steps 1 to 4: collect the keys, check the caps, read the traces, extract.
 *
 * Nothing here calls the classifier or spends anything, so a prepared page
 * that is never judged cost only its reads.
 */
export async function prepareLangWatchQLHydration(
  input: LangWatchQLHydrationInput,
): Promise<LangWatchQLPreparedHydration> {
  if (input.calls.length === 0) {
    return {
      input,
      resolved: [],
      traces: EMPTY_TRACES,
      extracted: new Map(),
      timings: { readMs: 0, computeMs: 0 },
    };
  }
  const resolved = collectKeys(input);
  assertKeyCaps(resolved);

  const startedRead = Date.now();
  const traces = await readTraces({ input, resolved });
  const startedCompute = Date.now();
  const extracted = await computeValues({ input, resolved, traces });
  return {
    input,
    resolved,
    traces,
    extracted,
    timings: {
      readMs: startedCompute - startedRead,
      computeMs: Date.now() - startedCompute,
    },
  };
}

/**
 * Step 5, and the assembly: judge what was extracted and build the result.
 *
 * `signal` replaces the one the input carried, where the caller only learns
 * how to cancel after the read: a run watches for cancellation per page, and
 * the page was read before that watch existed.
 */
export async function judgeLangWatchQLHydration({
  prepared,
  signal,
}: {
  prepared: LangWatchQLPreparedHydration;
  signal?: AbortSignal;
}): Promise<LangWatchQLHydrationResult> {
  const input =
    signal === undefined ? prepared.input : { ...prepared.input, signal };
  if (input.calls.length === 0) {
    return {
      columns: input.columns,
      rows: input.rows,
      isTruncatedByBytes: false,
      valueTruncations: [],
      unresolvedKeys: [],
    } satisfies LangWatchQLHydrationResult;
  }

  const { resolved, traces, extracted } = prepared;
  const startedJudge = Date.now();
  const judged = await judgeCalls({ input, resolved, traces });
  const finished = Date.now();

  return assembleResult({
    input,
    resolved,
    computed: merge([extracted, judged.values]),
    ...(judged.usage ? { evalUsage: judged.usage } : {}),
    timings: { ...prepared.timings, judgeMs: finished - startedJudge },
  });
}

const EMPTY_TRACES: FetchedTraces = { byId: new Map(), byThread: new Map() };

/**
 * The project a judgement is rated and billed against.
 *
 * A judgement has one owner, so the validator admits an eval call only for a
 * scope naming exactly one project. Reaching here with any other scope is a
 * programming error rather than anything a caller wrote, so it is a plain
 * `Error`: it degrades to an unknown failure with a trace id rather than
 * telling a customer to fix something they did not do (ADR-045).
 */
function judgingProjectOf(input: LangWatchQLHydrationInput): string {
  const only = input.projectIds.length === 1 ? input.projectIds[0] : undefined;
  if (only === undefined) {
    throw new Error(
      `an eval function reached hydration with ${input.projectIds.length} projects in scope; the validator admits one`,
    );
  }
  return only;
}

/**
 * Step 5: judge what the extraction produced.
 *
 * Skipped entirely when the statement called no eval function, and skipped
 * again when the deployment wired no classifier — in which case the judged
 * columns come back null, which is what the null classifier is for.
 */
async function judgeCalls({
  input,
  resolved,
  traces,
}: {
  input: LangWatchQLHydrationInput;
  resolved: readonly ResolvedCall[];
  traces: Awaited<ReturnType<typeof readTraces>>;
}): Promise<{ values: ComputedValues; usage?: LangWatchQLEvalUsage }> {
  const support = input.instantEvals;
  const hasEvalCalls = resolved.some(
    (entry) => entry.definition.kind === "eval",
  );
  if (!support || !hasEvalCalls) return { values: new Map() };

  try {
    const outcome = await evaluateCalls({
      projectId: judgingProjectOf(input),
      resolved,
      traces,
      support,
      ...(input.signal ? { signal: input.signal } : {}),
    });
    return { values: outcome.values, usage: outcome.usage };
  } catch (error) {
    if (error instanceof ClassifierAnsweredNothingError) {
      throw new InstantEvalClassifierUnavailableError({ reasons: [error] });
    }
    throw error;
  }
}

/** The extracted cells and the judged ones, in one map. */
function merge(parts: readonly ComputedValues[]): ComputedValues {
  const merged = new Map<string, ReadonlyMap<string, ComputedValue>>();
  for (const part of parts) {
    for (const [column, cells] of part) merged.set(column, cells);
  }
  return merged;
}
