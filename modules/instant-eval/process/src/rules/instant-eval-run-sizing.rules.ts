/**
 * How large one page of a run is. The size of the texts being judged bounds
 * what one worker holds, and the key cap of the statement's own app functions
 * bounds what the hydration stage accepts; the page is the smaller of the two.
 * @see specs/instant-evals/instant-eval-pipeline.feature
 */

import type { LangWatchQLAppFunctionCall } from "@langwatch/analytics-contract";

/**
 * Rows one page judges when the texts are ordinary: half the thousand-key cap
 * the hydration stage enforces for a trace or a span. A statement reading a
 * kind of key with a lower cap is cut to it by {@link instantEvalPageSizeFor}.
 */
export const INSTANT_EVAL_PAGE_SIZE = 500;

/** Rows one page judges when the texts are large. */
export const INSTANT_EVAL_SMALL_PAGE_SIZE = 100;

/**
 * Average text size past which a page is cut to a fifth. Twelve kilobytes is
 * about three thousand tokens, at which five hundred texts is six megabytes of
 * conversation in one worker's memory.
 */
export const INSTANT_EVAL_LARGE_TEXT_BYTES = 12 * 1024;

/** Rows a plan measures the text size of. */
export const INSTANT_EVAL_SAMPLE_ROWS = 50;

/**
 * The page size the sampled texts and the statement's key cap call for. The
 * hydration stage fails the whole run on a page over the cap rather than
 * returning fewer rows, so the cap is respected here, not discovered there.
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

/**
 * The hydration plan stored on a run, read back as the calls the validator
 * recorded. Stored as JSON, so an entry that is not a call is dropped rather
 * than failing the page it was read for.
 */
export function instantEvalHydrationPlan(stored: unknown): readonly LangWatchQLAppFunctionCall[] {
  if (!Array.isArray(stored)) return [];

  return stored.flatMap(readPlanEntry);
}

/** One stored plan entry, or nothing when it is not one. */
function readPlanEntry(entry: unknown): LangWatchQLAppFunctionCall[] {
  if (!entry || typeof entry !== "object") return [];
  const call = entry as Partial<LangWatchQLAppFunctionCall>;
  if (typeof call.column !== "string" || typeof call.function !== "string") return [];

  return [
    {
      column: call.column,
      function: call.function,
      options: Array.isArray(call.options) ? call.options : [],
      ...(call.source ? { source: call.source } : {}),
    },
  ];
}
