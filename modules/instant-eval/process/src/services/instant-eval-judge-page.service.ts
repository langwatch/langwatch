/**
 * Judging one page of a run: what it reads, what it judges, and where it says
 * the next page starts. The only step that spends money, and the only one a
 * cancel or an expiring lease may stop part way.
 * @see modules/instant-eval/specs/instant-eval-pipeline.feature
 */

import { instantEvalCostUsd, instantEvalPriceUsd } from "@langwatch/instant-eval-judge-contract";
import { createLogger } from "@langwatch/observability";
import { nowInstant } from "@langwatch/time";

import type { InstantEvalJudgeChannel } from "../channels/instant-eval-judge.channel.ts";
import type {
  InstantEvalPageOutcome,
  InstantEvalRunExecutor,
} from "../eventing/instant-eval-processing.intent.ts";
import type { InstantEvalCancellationRepository } from "../repositories/instant-eval-cancellation.repository.ts";
import type { InstantEvalJudgmentsRepository } from "../repositories/instant-eval-judgments.repository.ts";
import {
  INSTANT_EVAL_PAGE_FAILURE_CEILING,
  instantEvalPageFailureRate,
  instantEvalSkipReason,
  mapInstantEvalPage,
  type InstantEvalPageCounters,
} from "../rules/instant-eval-judgments.rules.ts";
import {
  cutPageAtStop,
  INSTANT_EVAL_CANCEL_POLL_MS,
  pageDeadlineMs,
  pageStopReason,
  type InstantEvalPageStop,
} from "../rules/instant-eval-page-stop.rules.ts";
import {
  instantEvalOwnedRows,
  type InstantEvalKeyPage,
} from "../rules/instant-eval-row-keys.rules.ts";
import { instantEvalHydrationPlan } from "../rules/instant-eval-run-sizing.rules.ts";
import type { InstantEvalTextSource } from "./instant-eval-estimate.service.ts";
import type { InstantEvalFreeBudgetService } from "./instant-eval-free-budget.service.ts";
import {
  INSTANT_EVAL_JUDGE_CONCURRENCY,
  InstantEvalJudgeRowsService,
  type InstantEvalJudgeUsage,
  type InstantEvalRowsJudgement,
} from "./instant-eval-judge-rows.service.ts";
import {
  InstantEvalReadAheadService,
  type InstantEvalReadPage,
} from "./instant-eval-read-ahead.service.ts";
import type { InstantEvalRowSourceService } from "./instant-eval-row-source.service.ts";
import type {
  InstantEvalLoadedRun,
  InstantEvalRunContextService,
} from "./instant-eval-run-context.service.ts";

const logger = createLogger("langwatch:instant-eval:judge-page");

/** A page that judged nothing, which is also what a cancelled run answers. */
const EMPTY_INSTANT_EVAL_PAGE: InstantEvalPageOutcome = {
  rows: 0,
  matched: 0,
  matchedByQuestion: {},
  failed: 0,
  skipped: 0,
  inputTokens: 0,
  requests: 0,
  cursor: null,
  cursorSpanId: null,
  hasNextPage: false,
};

type InstantEvalJudgePageInput = Parameters<InstantEvalRunExecutor["judgePage"]>[0];

export class InstantEvalJudgePageService {
  private readonly context: InstantEvalRunContextService;
  private readonly rowSource: Pick<InstantEvalRowSourceService, "keys">;
  private readonly textSource: InstantEvalTextSource;
  private readonly judge: InstantEvalJudgeChannel;
  private readonly judgments: Pick<InstantEvalJudgmentsRepository, "insert">;
  private readonly cancellation: InstantEvalCancellationRepository;
  private readonly budget: Pick<InstantEvalFreeBudgetService, "assertWithinBudget">;
  private readonly readAhead: InstantEvalReadAheadService;
  private readonly judgeRows: InstantEvalJudgeRowsService;
  private readonly now: () => number;

  private constructor(options: {
    context: InstantEvalRunContextService;
    rowSource: Pick<InstantEvalRowSourceService, "keys">;
    textSource: InstantEvalTextSource;
    judge: InstantEvalJudgeChannel;
    judgments: Pick<InstantEvalJudgmentsRepository, "insert">;
    cancellation: InstantEvalCancellationRepository;
    budget: Pick<InstantEvalFreeBudgetService, "assertWithinBudget">;
    readAhead: InstantEvalReadAheadService;
    concurrency: number;
    now: () => number;
  }) {
    this.context = options.context;
    this.rowSource = options.rowSource;
    this.textSource = options.textSource;
    this.judge = options.judge;
    this.judgments = options.judgments;
    this.cancellation = options.cancellation;
    this.budget = options.budget;
    this.readAhead = options.readAhead;
    this.judgeRows = InstantEvalJudgeRowsService.create({
      judge: options.judge,
      concurrency: options.concurrency,
    });
    this.now = options.now;
  }

  static create({
    context,
    rowSource,
    textSource,
    judge,
    judgments,
    cancellation,
    budget,
    readAhead = InstantEvalReadAheadService.create(),
    concurrency = INSTANT_EVAL_JUDGE_CONCURRENCY,
    now = () => nowInstant().epochMilliseconds,
  }: {
    context: InstantEvalRunContextService;
    rowSource: Pick<InstantEvalRowSourceService, "keys">;
    textSource: InstantEvalTextSource;
    judge: InstantEvalJudgeChannel;
    judgments: Pick<InstantEvalJudgmentsRepository, "insert">;
    cancellation: InstantEvalCancellationRepository;
    budget: Pick<InstantEvalFreeBudgetService, "assertWithinBudget">;
    /** The next page of each run, read while the current one judges. */
    readAhead?: InstantEvalReadAheadService;
    concurrency?: number;
    now?: () => number;
  }): InstantEvalJudgePageService {
    return new InstantEvalJudgePageService({
      context,
      rowSource,
      textSource,
      judge,
      judgments,
      cancellation,
      budget,
      readAhead,
      concurrency,
      now,
    });
  }

  /** One page: its keys, its verdicts, and what it added to the run. */
  async judgePage(input: InstantEvalJudgePageInput): Promise<InstantEvalPageOutcome> {
    try {
      return await this.#judgePageOrThrow(input);
    } catch (error) {
      // What was read ahead belongs to a loop that just broke; the retry
      // starts from the recorded cursor and reads for itself.
      this.readAhead.discard({ runId: input.runId });
      throw error;
    }
  }

  /** Drops what a run read ahead, once the run is finishing. */
  discardReadAhead({ runId }: { runId: string }): void {
    this.readAhead.discard({ runId });
  }

  async #judgePageOrThrow(input: InstantEvalJudgePageInput): Promise<InstantEvalPageOutcome> {
    const { projectId, runId, page } = input;
    // Before anything is read: a lease with no room left is a page not started
    // at all, and the throw is retried under a fresh one.
    this.#leaseMsLeft(input);
    const loaded = await this.context.load({ projectId, runId });

    // Checked before the page rather than during it: a page is seconds of
    // judging, and stopping between pages is what the cancel contract
    // promises. The watch below is what stops one already under way.
    if (await this.cancellation.isRequested({ runId })) {
      this.readAhead.discard({ runId });
      return EMPTY_INSTANT_EVAL_PAGE;
    }

    // Thrown rather than answered empty: a run stopped by the budget did not
    // finish its selection, and recording it as complete would report a
    // partial answer as the whole one.
    await this.budget.assertWithinBudget({
      projectId,
      reservationId: runId,
      inFlightUsd: this.#spentSoFarUsd(loaded.row.tokens),
    });

    const startedPage = this.now();
    const { keyPage, rows, isReadAhead } = await this.#takePageAndReadAhead({ loaded, input });
    if (keyPage.keys.length === 0) return EMPTY_INSTANT_EVAL_PAGE;

    const { judged, stop } = await this.#judgeKeys({ loaded, rows, input });
    const cut = cutPageAtStop({ judged, keys: keyPage.keys });
    const counters = await this.#write({
      loaded,
      input,
      judged,
      rows: cut.rows,
      keys: keyPage.keys,
      ...(stop && cut.unjudgedIndexes.size > 0
        ? { unjudgedRows: { indexes: cut.unjudgedIndexes, reason: pageStopReason(stop) } }
        : {}),
    });
    if (stop) {
      logger.info(
        { projectId, runId, page, stop, rows: cut.rows.length },
        "Instant Eval page stopped part way; what was judged is written",
      );
    }
    // A run slower than its judging is explained per page, not by the total.
    logger.debug(
      {
        projectId,
        runId,
        page,
        rows: counters.rows,
        inputTokens: judged.usage.inputTokens,
        isReadAhead,
        limiterWaitMs: judged.usage.limiterWaitMs,
        pageMs: this.now() - startedPage,
      },
      "Instant Eval page profile",
    );

    return outcomeFor({ input, cut, keyPage, counters, usage: judged.usage, stop });
  }

  /**
   * The page this intent asked for, off the read-ahead when it read this very
   * page, and the next one started behind it: by the time this returns, the
   * next page's reads are under way against services the judge does not use.
   */
  async #takePageAndReadAhead({
    loaded,
    input,
  }: {
    loaded: InstantEvalLoadedRun;
    input: InstantEvalJudgePageInput;
  }): Promise<InstantEvalReadPage & { isReadAhead: boolean }> {
    const cursor = {
      afterTraceId: input.afterTraceId,
      afterSpanId: input.afterSpanId,
      limit: input.pageSize,
    };
    const [taken] = await this.readAhead.take({ runId: input.runId, ...cursor });
    const current = taken ?? (await this.#readPage({ loaded, input, ...cursor }));

    const last = current.keyPage.keys.at(-1);
    const remaining = input.remaining - current.keyPage.keys.length;
    if (current.keyPage.hasMore && remaining > 0 && last) {
      // The limit the next intent asks for when every key became a judged
      // row, the common case; one asking for anything else misses.
      const next = {
        afterTraceId: last.traceId,
        afterSpanId: last.spanId ? last.spanId : null,
        limit: Math.max(1, Math.min(input.pageSize, remaining)),
      };
      this.readAhead.start({
        key: { runId: input.runId, ...next },
        read: () => this.#readPage({ loaded, input, ...next }),
      });
    }
    return { ...current, isReadAhead: taken !== undefined };
  }

  /** One page's keys, and the rows it owns with their texts in place. */
  async #readPage({
    loaded,
    input,
    afterTraceId,
    afterSpanId,
    limit,
  }: {
    loaded: InstantEvalLoadedRun;
    input: InstantEvalJudgePageInput;
    afterTraceId: string | null;
    afterSpanId: string | null;
    limit: number;
  }): Promise<InstantEvalReadPage> {
    const keyPage = await this.rowSource.keys({
      caller: loaded.caller,
      protections: loaded.protections,
      sql: loaded.row.sql,
      parameters: loaded.parameters,
      keyColumns: input.keyColumns,
      limit,
      ...(afterTraceId === null ? {} : { after: { traceId: afterTraceId, spanId: afterSpanId } }),
    });
    if (keyPage.keys.length === 0) return { keyPage, rows: [] };

    return {
      keyPage,
      rows: instantEvalOwnedRows({
        rows: await this.#readTexts({ loaded, keyPage }),
        keys: keyPage.keys,
      }),
    };
  }

  /**
   * What this run has already spent, priced the way its finish prices it. Read
   * off the run row rather than tracked here: the process that judges page six
   * need not be the one that judged page five, and the row is what they share.
   */
  #spentSoFarUsd(inputTokens: number): number {
    if (inputTokens <= 0) return 0;
    const { pricing } = this.judge;

    return instantEvalPriceUsd({
      costUsd: instantEvalCostUsd({ inputTokens, pricing }),
      pricing,
    });
  }

  /** The page's texts, judged, with a cancel or the lease able to stop it. */
  async #judgeKeys({
    loaded,
    rows,
    input,
  }: {
    loaded: InstantEvalLoadedRun;
    rows: readonly Record<string, unknown>[];
    input: InstantEvalJudgePageInput;
  }): Promise<{ judged: InstantEvalRowsJudgement; stop: InstantEvalPageStop | null }> {
    // Measured again after the reads, which spent part of the same lease.
    const deadlineMs = this.#leaseMsLeft(input);
    const deadline = Number.isFinite(deadlineMs) ? AbortSignal.timeout(deadlineMs) : null;
    const watch = this.#watchForCancellation(input);
    const stops = [watch.signal, deadline].filter((candidate) => candidate !== null);
    const signal = stops.length > 0 ? AbortSignal.any(stops) : null;
    try {
      const judged = await this.judgeRows.judgeRows({
        projectId: input.projectId,
        rows,
        questions: loaded.questions,
        signal,
      });

      return { judged, ...pageStopFor({ watch: watch.signal, deadline }) };
    } finally {
      watch.stop();
    }
  }

  /**
   * How long the page may judge before its lease is at risk, unbounded where
   * nothing leased the delivery. Judging past the lease is a page another
   * dispatcher may start again, and pay for twice, so it is refused instead.
   */
  #leaseMsLeft(input: InstantEvalJudgePageInput): number {
    const deadlineMs = pageDeadlineMs({ deadlineAt: input.deadlineAt, now: this.now() });
    if (deadlineMs > 0) return deadlineMs;

    throw new Error(
      `instant eval page ${input.page} of run ${input.runId} has no lease left to judge under; retrying under a fresh one`,
    );
  }

  /** The page's rows with the judged columns holding text, nothing judged yet. */
  async #readTexts({
    loaded,
    keyPage,
  }: {
    loaded: InstantEvalLoadedRun;
    keyPage: InstantEvalKeyPage;
  }): Promise<readonly Record<string, unknown>[]> {
    const traceIds = [...new Set(keyPage.keys.map((key) => key.traceId))];
    if (traceIds.length === 0) return [];

    return this.textSource.texts({
      project: loaded.caller,
      protections: loaded.protections,
      sql: loaded.row.sql,
      parameters: loaded.parameters,
      calls: instantEvalHydrationPlan(loaded.row.plan),
      traceIds,
    });
  }

  /** An abort signal that fires once the run has been asked to stop. */
  #watchForCancellation({ projectId, runId }: InstantEvalJudgePageInput): {
    signal: AbortSignal;
    stop: () => void;
  } {
    const controller = new AbortController();
    const timer = setInterval(() => {
      void this.cancellation
        .isRequested({ runId })
        .then((isRequested) => {
          if (isRequested) controller.abort();
        })
        .catch((error: unknown) => {
          // A read that fails leaves the page running, which is the safe
          // direction: the between-pages check still stops the run.
          logger.warn(
            { projectId, runId, error },
            "Instant Eval cancellation check failed mid-page",
          );
        });
    }, INSTANT_EVAL_CANCEL_POLL_MS);
    timer.unref?.();

    return { signal: controller.signal, stop: () => clearInterval(timer) };
  }

  /**
   * The judgements, then the counters. Written BEFORE the page is recorded as
   * judged, keyed so a redelivery re-inserts the same rows rather than
   * doubling them; a page that mostly failed is thrown instead of written.
   */
  async #write({
    loaded,
    input,
    judged,
    rows,
    keys,
    unjudgedRows,
  }: {
    loaded: InstantEvalLoadedRun;
    input: InstantEvalJudgePageInput;
    judged: InstantEvalRowsJudgement;
    rows: readonly Record<string, unknown>[];
    keys: Parameters<typeof mapInstantEvalPage>[0]["keys"];
    unjudgedRows?: Parameters<typeof mapInstantEvalPage>[0]["unjudgedRows"];
  }): Promise<InstantEvalPageCounters> {
    const mapping = mapInstantEvalPage({
      tenantId: input.projectId,
      runId: input.runId,
      questions: loaded.questions,
      rows,
      keys,
      skipReason: instantEvalSkipReason(judged.usage.skipped),
      ...(unjudgedRows ? { unjudgedRows } : {}),
      now: this.now(),
    });
    const failureRate = instantEvalPageFailureRate({
      counters: mapping.counters,
      questions: loaded.questions.length,
    });
    if (failureRate > INSTANT_EVAL_PAGE_FAILURE_CEILING) {
      throw new Error(
        `instant eval page ${input.page} of run ${input.runId} lost ${Math.round(failureRate * 100)}% of its judgements`,
      );
    }
    await this.judgments.insert(mapping.records);

    return mapping.counters;
  }
}

/**
 * Where the next page starts and whether there is one. A page cut short ends
 * where its judging did; one that judged nothing stays where it started, so
 * the next intent asks for the same rows. A cancelled run has no next page.
 */
function outcomeFor({
  input,
  cut,
  keyPage,
  counters,
  usage,
  stop,
}: {
  input: InstantEvalJudgePageInput;
  cut: ReturnType<typeof cutPageAtStop>;
  keyPage: InstantEvalKeyPage;
  counters: InstantEvalPageCounters;
  usage: InstantEvalJudgeUsage;
  stop: InstantEvalPageStop | null;
}): InstantEvalPageOutcome {
  const resumeFrom = cut.last ?? (cut.isCutShort ? null : keyPage.keys.at(-1));
  const cursor =
    resumeFrom === null || resumeFrom === undefined
      ? { traceId: input.afterTraceId, spanId: input.afterSpanId }
      : { traceId: resumeFrom.traceId, spanId: resumeFrom.spanId || null };
  const hasRowsLeft = (cut.isCutShort || keyPage.hasMore) && input.remaining - counters.rows > 0;

  return {
    ...counters,
    inputTokens: usage.inputTokens,
    requests: usage.requests,
    cursor: cursor.traceId,
    // Empty when the statement has one row per trace, which is what tells the
    // next key pass to compare the trace alone.
    cursorSpanId: cursor.spanId,
    hasNextPage: stop === "cancelled" ? false : hasRowsLeft,
  };
}

/** Which stop reached the page, if any. A cancel outranks the deadline. */
function pageStopFor({ watch, deadline }: { watch: AbortSignal; deadline: AbortSignal | null }): {
  stop: InstantEvalPageStop | null;
} {
  if (watch.aborted) return { stop: "cancelled" };

  return { stop: deadline?.aborted ? "deadline" : null };
}
