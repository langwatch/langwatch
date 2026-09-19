/**
 * The next page of a run, read while the current one is judged.
 *
 * ## Why the next page is read while this one judges
 *
 * A page is a read (the statement, the traces, the texts) and then a judging,
 * and the two are bound by different services. Run one after the other, the
 * read sits on the critical path of every page; run the next page's read
 * while this page judges and it does not. One page still judges at a time,
 * because the judge is what saturates and the tenant's share of it bounds a
 * run anyway.
 *
 * @see ./instant-eval-run.judge-page.ts: the step that takes these pages
 * @see ./row-source.ts: the reads a page is made of
 */

import { createLogger } from "@langwatch/observability";

import type { InstantEvalRunPort } from "~/server/event-sourcing/pipelines/instant-eval-processing/process-manager";
import {
  type InstantEvalLoadedRun,
  type InstantEvalRunExecutorDependencies,
  instantEvalHydrationPlan,
} from "./instant-eval-run.executor";
import type {
  InstantEvalKeyPage,
  InstantEvalPreparedPage,
  InstantEvalRowKey,
} from "./row-source";

const logger = createLogger("langwatch:instant-evals:run-prefetch");

/** What the next page needs to have been read with, to be the same page. */
export interface PrefetchKey {
  readonly runId: string;
  readonly afterTraceId: string | null;
  readonly afterSpanId: string | null;
  readonly limit: number;
}

/** One page's keys and its read, started before the run asked for it. */
export interface PrefetchedPage {
  readonly keyPage: InstantEvalKeyPage;
  readonly prepared: InstantEvalPreparedPage | null;
  /** How long the key pass took, for the page profile. */
  readonly keyMs: number;
}

/** Where a key pass resumes from, and how many keys it asks for. */
interface PageCursor {
  afterTraceId: string | null;
  afterSpanId: string | null;
  limit: number;
}

/**
 * The next page of each run, read while the current one is judged.
 *
 * The judge is the bottleneck of a run and it is a different service from the
 * database and the trace store, so a page's reads only lengthen the run when
 * they sit on the critical path. The page after the one being judged is
 * therefore started here, keyed by the cursor the next intent will arrive
 * with, and handed over when it does. One page judges at a time, exactly as
 * before: only the reading overlaps.
 *
 * Per executor and per pod, and best-effort throughout: an intent that lands
 * on another pod misses and reads the page itself, a run that stops or fails
 * drops what it had read, and a prefetch that fails is discarded rather than
 * surfaced, because the page it read will be read again by the intent that
 * needs it. Nothing here is recorded anywhere, so nothing here changes what a
 * redelivery does.
 */
/**
 * Runs whose read-ahead one process keeps at once. A run whose next intent
 * lands on another process never takes its page here, and without a bound
 * every such run would hold a hydrated page for the life of the process; past
 * the bound the oldest is dropped, which costs that run one page read.
 */
export const INSTANT_EVAL_PREFETCH_RUN_CAP = 64;

export class InstantEvalPrefetches {
  private readonly byRun = new Map<
    string,
    { key: PrefetchKey; page: Promise<PrefetchedPage> }
  >();

  start(key: PrefetchKey, read: () => Promise<PrefetchedPage>): void {
    const page = read();
    // A prefetch nobody consumes must not surface as an unhandled rejection;
    // its failure is observed, if at all, by the intent that takes it.
    page.catch(() => undefined);
    // Re-set so the run moves to the back of the insertion order, which is
    // what makes the eviction below drop the run touched longest ago.
    this.byRun.delete(key.runId);
    this.byRun.set(key.runId, { key, page });
    for (const runId of this.byRun.keys()) {
      if (this.byRun.size <= INSTANT_EVAL_PREFETCH_RUN_CAP) break;
      this.byRun.delete(runId);
    }
  }

  /** How many runs hold a read-ahead here. */
  get size(): number {
    return this.byRun.size;
  }

  /** The page read for this key, or null when none was, or it was another page. */
  async take(key: PrefetchKey): Promise<PrefetchedPage | null> {
    const entry = this.byRun.get(key.runId);
    if (!entry) return null;
    this.byRun.delete(key.runId);
    if (
      entry.key.afterTraceId !== key.afterTraceId ||
      entry.key.afterSpanId !== key.afterSpanId ||
      entry.key.limit !== key.limit
    ) {
      return null;
    }
    try {
      return await entry.page;
    } catch (error) {
      logger.warn(
        { runId: key.runId, error },
        "Instant Eval prefetched page failed; reading it again",
      );
      return null;
    }
  }

  discard(runId: string): void {
    this.byRun.delete(runId);
  }
}

/**
 * One page's keys, and the rows behind them, read and extracted but unjudged.
 *
 * Its own function because both the page being judged now and the page being
 * read ahead go through it, and the read-ahead has to be the same read or the
 * page it hands over would not be the page the next intent asked for.
 */
async function readPage({
  deps,
  projectId,
  row,
  caller,
  parameters,
  keyColumns,
  after,
}: {
  deps: InstantEvalRunExecutorDependencies;
  projectId: string;
  row: InstantEvalLoadedRun["row"];
  caller: InstantEvalLoadedRun["caller"];
  parameters: InstantEvalLoadedRun["parameters"];
  keyColumns: Parameters<InstantEvalRunPort["judgePage"]>[0]["keyColumns"];
  after: PageCursor;
}): Promise<PrefetchedPage> {
  const startedKeys = Date.now();
  const keyPage = await deps.rowSource.keys({
    caller,
    sql: row.sql,
    parameters,
    keyColumns,
    limit: after.limit,
    ...(after.afterTraceId === null
      ? {}
      : {
          after: {
            traceId: after.afterTraceId,
            spanId: after.afterSpanId,
          },
        }),
  });
  const keyMs = Date.now() - startedKeys;
  if (keyPage.keys.length === 0) return { keyPage, prepared: null, keyMs };
  const prepared = await deps.rowSource.read({
    caller,
    protections: await deps.protections(projectId),
    sql: row.sql,
    parameters,
    calls: instantEvalHydrationPlan(row.plan),
    keys: keyPage.keys,
    classifier: deps.classifier(),
    maxConcurrency: deps.maxConcurrency,
  });
  return { keyPage, prepared, keyMs };
}

/**
 * Starts the next page's read while this one judges.
 *
 * Its limit is what the next intent will ask for when every key of this page
 * becomes a judged row, which is the common case; an intent that arrives
 * asking for anything else misses and reads for itself.
 */
function startNextPageRead({
  prefetches,
  runId,
  read,
  last,
  hasMore,
  remaining,
  pageSize,
}: {
  prefetches: InstantEvalPrefetches;
  runId: string;
  read: (after: PageCursor) => Promise<PrefetchedPage>;
  last: InstantEvalRowKey | undefined;
  hasMore: boolean;
  remaining: number;
  pageSize: number;
}): void {
  if (!hasMore || remaining <= 0 || !last) return;
  const after: PageCursor = {
    afterTraceId: last.traceId,
    afterSpanId: last.spanId ? last.spanId : null,
    limit: Math.max(1, Math.min(pageSize, remaining)),
  };
  prefetches.start({ runId, ...after }, () => read(after));
}

/**
 * The page this intent asked for, and the next one started behind it.
 *
 * The read-ahead is started here rather than after judging because the point
 * of it is to overlap the two: by the time this returns, the next page's key
 * pass and trace read are already under way against services the classifier
 * does not contend with. `isPrefetched` says whether this page came off that
 * read, which is what tells the profile its key and query time was paid before
 * the intent arrived.
 */
export async function takePageAndReadAhead({
  deps,
  prefetches,
  input,
  row,
  caller,
  parameters,
}: {
  deps: InstantEvalRunExecutorDependencies;
  prefetches: InstantEvalPrefetches;
  input: Parameters<InstantEvalRunPort["judgePage"]>[0];
  row: InstantEvalLoadedRun["row"];
  caller: InstantEvalLoadedRun["caller"];
  parameters: InstantEvalLoadedRun["parameters"];
}): Promise<PrefetchedPage & { isPrefetched: boolean }> {
  const { runId, projectId, afterTraceId, afterSpanId, pageSize, remaining } =
    input;
  const limit = Math.max(1, Math.min(pageSize, remaining));
  const read = (after: PageCursor) =>
    readPage({
      deps,
      projectId,
      row,
      caller,
      parameters,
      keyColumns: input.keyColumns,
      after,
    });

  const taken = await prefetches.take({
    runId,
    afterTraceId,
    afterSpanId,
    limit,
  });
  const current = taken ?? (await read({ afterTraceId, afterSpanId, limit }));
  startNextPageRead({
    prefetches,
    runId,
    read,
    last: current.keyPage.keys.at(-1),
    hasMore: current.keyPage.hasMore,
    remaining: remaining - current.keyPage.keys.length,
    pageSize,
  });
  return { ...current, isPrefetched: taken !== null };
}
