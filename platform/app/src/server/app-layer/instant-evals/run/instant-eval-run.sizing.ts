/**
 * How large one page of a run is, and what decides it.
 *
 * Two bounds meet here: the size of the texts being judged, which is about
 * what one worker holds in memory, and the key cap of the app functions the
 * statement calls, which is about what the hydration stage will accept. The
 * page is the smaller of the two, because the cap is enforced there by failing
 * the whole run rather than by returning fewer rows.
 *
 * @see ./instant-eval-run.plan.ts: the step that chooses a run's page size
 * @see ~/server/analytics/lwql: where the app function caps are declared
 */

import {
  type LangWatchQLAppFunctionCall,
  lwqlAppFunction,
  lwqlAppFunctionCap,
} from "~/server/analytics/lwql";

/**
 * Rows one page judges when the texts are ordinary.
 *
 * Five hundred, which is half the thousand-key cap the hydration stage
 * enforces for a trace or a span. A statement whose extraction reads another
 * kind of key has a lower cap of its own, and
 * {@link instantEvalPageSizeFor} lowers the page to it: `threads` caps at two
 * hundred keys, so a five hundred row page over conversations fails the whole
 * run with `lwql_app_function_key_cap` rather than judging anything.
 */
export const INSTANT_EVAL_PAGE_SIZE = 500;

/** Rows one page judges when the texts are large. */
export const INSTANT_EVAL_SMALL_PAGE_SIZE = 100;

/**
 * Average text size past which a page is cut to a fifth.
 *
 * Twelve kilobytes is about three thousand tokens, at which five hundred texts
 * is a page holding six megabytes of conversation in memory at once while
 * thirty-two of them are in flight. The smaller page is not about the
 * classifier, which takes them one at a time either way; it is about what one
 * worker holds.
 */
export const INSTANT_EVAL_LARGE_TEXT_BYTES = 12 * 1024;

/**
 * The keys one execution of this statement may hydrate, the lowest cap wins.
 *
 * Every app function the statement calls carries a cap by the kind of key it
 * reads, and one execution has to satisfy all of them at once. A statement
 * over conversations is the case that matters: its cap is two hundred, far
 * below the five hundred a page would otherwise hold.
 */
export function instantEvalKeyCapFor(
  calls: readonly LangWatchQLAppFunctionCall[],
): number {
  const caps = calls.flatMap((call) => {
    const names = [call.function, call.source?.function].filter(
      (name): name is string => typeof name === "string",
    );
    return names.flatMap((name) => {
      const definition = lwqlAppFunction(name);
      return definition ? [lwqlAppFunctionCap(definition)] : [];
    });
  });
  return caps.length === 0 ? INSTANT_EVAL_PAGE_SIZE : Math.min(...caps);
}

/**
 * The page size the sampled texts and the statement's key caps call for.
 *
 * The text size chooses a page, and the key cap bounds it: a page over the cap
 * is refused by the hydration stage, which fails the run rather than returning
 * fewer rows, so the cap has to be respected here and not discovered there.
 */
export function instantEvalPageSizeFor({
  averageTextBytes,
  keyCap = INSTANT_EVAL_PAGE_SIZE,
}: {
  averageTextBytes: number;
  keyCap?: number;
}): number {
  const byText =
    averageTextBytes > INSTANT_EVAL_LARGE_TEXT_BYTES
      ? INSTANT_EVAL_SMALL_PAGE_SIZE
      : INSTANT_EVAL_PAGE_SIZE;
  return Math.max(1, Math.min(byText, keyCap));
}

/** The mean byte length of the judged texts in a sample of rows. */
export function instantEvalAverageTextBytes({
  rows,
  questionIds,
}: {
  rows: readonly Record<string, unknown>[];
  questionIds: readonly string[];
}): number {
  let bytes = 0;
  let texts = 0;
  for (const row of rows) {
    for (const id of questionIds) {
      const value = row[id];
      if (typeof value !== "string") continue;
      bytes += Buffer.byteLength(value, "utf8");
      texts += 1;
    }
  }
  return texts === 0 ? 0 : Math.round(bytes / texts);
}
