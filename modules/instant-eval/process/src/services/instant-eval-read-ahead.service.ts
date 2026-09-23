/**
 * The next page of each run, read while the current one is judged. The judge
 * is what saturates, so a page's reads only lengthen a run on its critical
 * path. Per process and best-effort: a miss reads the page itself.
 * @see specs/instant-evals/instant-eval-pipeline.feature
 */

import { createLogger } from "@langwatch/observability";

import type { InstantEvalKeyPage } from "../rules/instant-eval-row-keys.rules.ts";

const logger = createLogger("langwatch:instant-eval:read-ahead");

/**
 * Runs whose read-ahead one process keeps at once. A run whose next intent
 * lands on another process never takes its page here; past the bound the
 * oldest is dropped, which costs that run one page read.
 */
export const INSTANT_EVAL_READ_AHEAD_RUN_CAP = 64;

/** What the next page must have been read with, to be the same page. */
export type InstantEvalReadAheadKey = Readonly<{
  runId: string;
  afterTraceId: string | null;
  afterSpanId: string | null;
  limit: number;
}>;

/** One page's keys and the rows it owns with their texts in place, unjudged. */
export type InstantEvalReadPage = Readonly<{
  keyPage: InstantEvalKeyPage;
  rows: readonly Record<string, unknown>[];
}>;

export class InstantEvalReadAheadService {
  readonly #byRun = new Map<
    string,
    { key: InstantEvalReadAheadKey; page: Promise<InstantEvalReadPage> }
  >();

  private constructor() {}

  static create(): InstantEvalReadAheadService {
    return new InstantEvalReadAheadService();
  }

  /** Starts reading a run's next page; a later start for the run replaces it. */
  start({
    key,
    read,
  }: {
    key: InstantEvalReadAheadKey;
    read: () => Promise<InstantEvalReadPage>;
  }): void {
    const page = read();
    // Observed, if at all, by the intent that takes it; never unhandled.
    page.catch(() => undefined);
    this.#byRun.delete(key.runId);
    this.#byRun.set(key.runId, { key, page });
    for (const runId of this.#byRun.keys()) {
      if (this.#byRun.size <= INSTANT_EVAL_READ_AHEAD_RUN_CAP) break;
      this.#byRun.delete(runId);
    }
  }

  /** The page read for exactly this key; empty when none was, it was another page, or it failed. */
  async take(key: InstantEvalReadAheadKey): Promise<InstantEvalReadPage[]> {
    const entry = this.#byRun.get(key.runId);
    if (!entry) return [];
    this.#byRun.delete(key.runId);
    if (
      entry.key.afterTraceId !== key.afterTraceId ||
      entry.key.afterSpanId !== key.afterSpanId ||
      entry.key.limit !== key.limit
    ) {
      return [];
    }
    try {
      return [await entry.page];
    } catch (error) {
      logger.warn(
        { runId: key.runId, error },
        "Instant Eval page read ahead failed; reading it again",
      );
      return [];
    }
  }

  /** Drops what a run read ahead: it stopped, failed, or finished. */
  discard({ runId }: { runId: string }): void {
    this.#byRun.delete(runId);
  }

  /** How many runs hold a read-ahead here. */
  get size(): number {
    return this.#byRun.size;
  }
}
