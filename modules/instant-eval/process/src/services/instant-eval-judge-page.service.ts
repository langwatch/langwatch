/**
 * Judging one page of a run: what it reads, what it judges, and where it says
 * the next page starts. The only step that spends money, and the only one a
 * cancel or an expiring lease may stop part way.
 * @see specs/instant-evals/instant-eval-pipeline.feature
 */

import {
  InstantEvalClassifierUnavailableError,
  type InstantEvalJudgement,
  type InstantEvalVerdict,
} from "@langwatch/instant-eval-contract";
import { createLogger } from "@langwatch/observability";
import { nowInstant } from "@langwatch/time";

import type { InstantEvalCancellationChannel } from "../channels/instant-eval-cancellation.channel.ts";
import type { InstantEvalJudgeChannel } from "../channels/instant-eval-judge.channel.ts";
import type {
  InstantEvalPageOutcome,
  InstantEvalRunExecutor,
} from "../eventing/instant-eval-processing.intent.ts";
import type { InstantEvalJudgmentsRepository } from "../repositories/instant-eval-judgments.repository.ts";
import {
  assertInstantEvalPageBudget,
  instantEvalJudgedRows,
  instantEvalJudgementUnits,
  instantEvalPageTokenBudget,
  type InstantEvalJudgementUnit,
} from "../rules/instant-eval-judge-page.rules.ts";
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
import { instantEvalCostUsd, instantEvalPriceUsd } from "../rules/instant-eval-pricing.rules.ts";
import {
  instantEvalOwnedRows,
  type InstantEvalKeyPage,
} from "../rules/instant-eval-row-keys.rules.ts";
import { instantEvalHydrationPlan } from "../rules/instant-eval-run-sizing.rules.ts";
import type { InstantEvalTextSource } from "./instant-eval-estimate.service.ts";
import type { InstantEvalFreeBudgetService } from "./instant-eval-free-budget.service.ts";
import type { InstantEvalRowSourceService } from "./instant-eval-row-source.service.ts";
import type {
  InstantEvalLoadedRun,
  InstantEvalRunContextService,
} from "./instant-eval-run-context.service.ts";

const logger = createLogger("langwatch:instant-eval:judge-page");

/**
 * Classifications one page keeps in flight. High enough that the judge's own
 * token bucket, rather than the number of open requests, is what a page waits
 * on: at about 250 ms a call, thirty-two could never reach that rate.
 */
export const INSTANT_EVAL_PAGE_CONCURRENCY = 128;

/** What one page's requests sent and what they cost it. */
interface InstantEvalPageUsage {
  requests: number;
  inputTokens: number;
  skipped: Record<string, number>;
  limiterWaitMs: number;
}

/** One page, judged: the rows as they are written, and what they sent. */
export interface InstantEvalJudgedPage {
  readonly rows: readonly Record<string, unknown>[];
  readonly usage: InstantEvalPageUsage;
  /** Present when a stop reached the page, naming the rows it left unjudged. */
  readonly cancellation?: { readonly unjudgedRows: readonly number[] };
}

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
  private constructor(
    private readonly context: InstantEvalRunContextService,
    private readonly rowSource: Pick<InstantEvalRowSourceService, "keys">,
    private readonly textSource: InstantEvalTextSource,
    private readonly judge: InstantEvalJudgeChannel,
    private readonly judgments: Pick<InstantEvalJudgmentsRepository, "insert">,
    private readonly cancellation: InstantEvalCancellationChannel,
    private readonly budget: Pick<InstantEvalFreeBudgetService, "assertWithinBudget">,
    private readonly concurrency: number,
    private readonly now: () => number,
  ) {}

  static create({
    context,
    rowSource,
    textSource,
    judge,
    judgments,
    cancellation,
    budget,
    concurrency = INSTANT_EVAL_PAGE_CONCURRENCY,
    now = () => nowInstant().epochMilliseconds,
  }: {
    context: InstantEvalRunContextService;
    rowSource: Pick<InstantEvalRowSourceService, "keys">;
    textSource: InstantEvalTextSource;
    judge: InstantEvalJudgeChannel;
    judgments: Pick<InstantEvalJudgmentsRepository, "insert">;
    cancellation: InstantEvalCancellationChannel;
    budget: Pick<InstantEvalFreeBudgetService, "assertWithinBudget">;
    concurrency?: number;
    now?: () => number;
  }): InstantEvalJudgePageService {
    return new InstantEvalJudgePageService(
      context,
      rowSource,
      textSource,
      judge,
      judgments,
      cancellation,
      budget,
      concurrency,
      now,
    );
  }

  /** One page: its keys, its verdicts, and what it added to the run. */
  async judgePage(input: InstantEvalJudgePageInput): Promise<InstantEvalPageOutcome> {
    const { projectId, runId, page } = input;
    // Before anything is read: a lease with no room left is a page not started
    // at all, and the throw is retried under a fresh one.
    this.#leaseMsLeft(input);
    const loaded = await this.context.load({ projectId, runId });

    // Checked before the page rather than during it: a page is seconds of
    // judging, and stopping between pages is what the cancel contract
    // promises. The watch below is what stops one already under way.
    if (await this.cancellation.isRequested({ runId })) return EMPTY_INSTANT_EVAL_PAGE;

    // Thrown rather than answered empty: a run stopped by the budget did not
    // finish its selection, and recording it as complete would report a
    // partial answer as the whole one.
    await this.budget.assertWithinBudget({
      projectId,
      reservationId: runId,
      inFlightUsd: this.#spentSoFarUsd(loaded.row.tokens),
    });

    const keyPage = await this.rowSource.keys({
      caller: loaded.caller,
      protections: loaded.protections,
      sql: loaded.row.sql,
      parameters: loaded.parameters,
      keyColumns: input.keyColumns,
      limit: input.pageSize,
      ...(input.afterTraceId === null
        ? {}
        : { after: { traceId: input.afterTraceId, spanId: input.afterSpanId } }),
    });
    if (keyPage.keys.length === 0) return EMPTY_INSTANT_EVAL_PAGE;

    const { judged, stop } = await this.#judgeKeys({ loaded, keyPage, input });
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

    return outcomeFor({ input, cut, keyPage, counters, usage: judged.usage, stop });
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
    keyPage,
    input,
  }: {
    loaded: InstantEvalLoadedRun;
    keyPage: InstantEvalKeyPage;
    input: InstantEvalJudgePageInput;
  }): Promise<{ judged: InstantEvalJudgedPage; stop: InstantEvalPageStop | null }> {
    const rows = instantEvalOwnedRows({
      rows: await this.#readTexts({ loaded, keyPage }),
      keys: keyPage.keys,
    });
    // Measured again after the reads, which spent part of the same lease.
    const deadlineMs = this.#leaseMsLeft(input);
    const deadline = Number.isFinite(deadlineMs) ? AbortSignal.timeout(deadlineMs) : null;
    const watch = this.#watchForCancellation(input);
    const stops = [watch.signal, deadline].filter((candidate) => candidate !== null);
    const signal = stops.length > 0 ? AbortSignal.any(stops) : null;
    try {
      const judged = await this.#judgeRows({
        loaded,
        rows,
        projectId: input.projectId,
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
      `instant eval page ${input.page} of run ${input.runId} has no lease left to judge under`,
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

  /** One request per text, at most {@link concurrency} of them in flight. */
  async #judgeRows({
    loaded,
    rows,
    projectId,
    signal,
  }: {
    loaded: InstantEvalLoadedRun;
    rows: readonly Record<string, unknown>[];
    projectId: string;
    signal: AbortSignal | null;
  }): Promise<InstantEvalJudgedPage> {
    const { limits } = this.judge;
    const units = instantEvalJudgementUnits({ rows, questions: loaded.questions, limits });
    assertInstantEvalPageBudget({
      units,
      budget: instantEvalPageTokenBudget({ rows: rows.length, limits }),
      limits,
    });

    const usage: InstantEvalPageUsage = {
      requests: 0,
      inputTokens: 0,
      skipped: {},
      limiterWaitMs: 0,
    };
    const cells = new Map<number, Map<string, InstantEvalVerdict | null>>();
    let failures = 0;
    const isCancelled = await inParallel({
      items: units,
      limit: this.concurrency,
      signal,
      run: async (unit) => {
        const judgement = await this.#classify({ projectId, unit, signal });
        if (judgement === null) failures += 1;
        record({ unit, judgement: judgement ?? LOST_JUDGEMENT, cells, usage });
      },
    });
    // Every unit failing is not a row-level problem: it is the judge not
    // answering at all, and a page of nulls would read as "nothing matched".
    if (failures > 0 && failures === units.length) {
      throw new InstantEvalClassifierUnavailableError();
    }

    const judged = instantEvalJudgedRows({ rows, questions: loaded.questions, cells });

    return {
      rows: judged.rows,
      usage,
      ...(isCancelled ? { cancellation: { unjudgedRows: judged.unjudgedRows } } : {}),
    };
  }

  /**
   * One unit's judgement, or null when the judge could not be used. A stop is
   * rethrown rather than counted: swallowing it would turn an abandoned page
   * into a page of nulls and let the remaining units keep spending.
   */
  async #classify({
    projectId,
    unit,
    signal,
  }: {
    projectId: string;
    unit: InstantEvalJudgementUnit;
    signal: AbortSignal | null;
  }): Promise<InstantEvalJudgement | null> {
    try {
      return await this.judge.classify(
        {
          projectId,
          text: unit.text,
          questions: unit.questions.map((question) => question.question),
        },
        signal ?? undefined,
      );
    } catch (error) {
      if (signal?.aborted || isAbortError(error)) throw error;

      return null;
    }
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
    judged: InstantEvalJudgedPage;
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

/** What a unit the judge lost is recorded as: a skip, with the reason. */
const LOST_JUDGEMENT: InstantEvalJudgement = {
  verdicts: [],
  skippedReason: "classifier_failed",
  inputTokens: 0,
  isTextTruncated: false,
};

/**
 * One answer, filed. Every question of the unit gets a cell — null where the
 * judgement carries no verdict for it — because a question that was asked and
 * declined is a null the page explains, not one a stop left behind.
 */
function record({
  unit,
  judgement,
  cells,
  usage,
}: {
  unit: InstantEvalJudgementUnit;
  judgement: InstantEvalJudgement;
  cells: Map<number, Map<string, InstantEvalVerdict | null>>;
  usage: InstantEvalPageUsage;
}): void {
  usage.requests += 1;
  usage.inputTokens += judgement.inputTokens;
  usage.limiterWaitMs += judgement.limiterWaitMs ?? 0;
  if (judgement.skippedReason) {
    usage.skipped[judgement.skippedReason] = (usage.skipped[judgement.skippedReason] ?? 0) + 1;
  }

  const byQuestion = new Map(judgement.verdicts.map((verdict) => [verdict.questionId, verdict]));
  const row = cells.get(unit.rowIndex) ?? new Map<string, InstantEvalVerdict | null>();
  for (const question of unit.questions) {
    row.set(question.id, byQuestion.get(question.id) ?? null);
  }
  cells.set(unit.rowIndex, row);
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
  usage: InstantEvalPageUsage;
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

/** Whether a thrown value is a stop rather than a failure. */
function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
}

/**
 * Runs the units with a fixed number in flight, answering whether a stop ended
 * the scheduling. A stop settles what is in flight rather than throwing: a
 * unit already answered was paid for, and its verdict is kept.
 */
async function inParallel<T>({
  items,
  limit,
  run,
  signal,
}: {
  items: readonly T[];
  limit: number;
  run: (item: T) => Promise<void>;
  signal: AbortSignal | null;
}): Promise<boolean> {
  let next = 0;
  const take = () => items[next++];
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, () =>
      drain({ take, run, signal }),
    ),
  );

  return signal?.aborted === true;
}

/**
 * One worker: takes units until there are none, or until the signal fires.
 * Checked between units as well as inside the request, so a page the caller
 * walked away from stops before the next classification.
 */
async function drain<T>({
  take,
  run,
  signal,
}: {
  take: () => T | undefined;
  run: (item: T) => Promise<void>;
  signal: AbortSignal | null;
}): Promise<void> {
  while (!signal?.aborted) {
    const item = take();
    if (item === undefined) return;
    if (await runOrStop({ item, run, signal })) return;
  }
}

/**
 * Runs one unit; true when the stop ended it, which ends the worker too. Only
 * the page's own signal is a stop: an abort the judge raised on its own is a
 * failed unit, and swallowing it would read as a judge answering nulls.
 */
async function runOrStop<T>({
  item,
  run,
  signal,
}: {
  item: T;
  run: (item: T) => Promise<void>;
  signal: AbortSignal | null;
}): Promise<boolean> {
  try {
    await run(item);

    return false;
  } catch (error) {
    if (signal?.aborted) return true;
    throw error;
  }
}
