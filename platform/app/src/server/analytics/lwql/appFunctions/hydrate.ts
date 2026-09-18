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

import { assembleResult } from "./hydration/assemble";
import { computeValues } from "./hydration/compute";
import type {
  LangWatchQLHydrationInput,
  LangWatchQLHydrationResult,
} from "./hydration/contract";
import { assertKeyCaps, collectKeys } from "./hydration/keys";
import { readTraces } from "./hydration/read";

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
      isTruncatedByBytes: false,
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
