/**
 * One synchronous LangWatchQL query's judging (Alex, 2026-10-06, "Judge cycle"): the price of
 * the whole query token budget held first, the rows judged, the spend recorded once, the hold
 * dropped. A spend that never reached the ledger keeps its hold until the hold lapses.
 * @see specs/lwql/eval-functions.feature
 */

import type {
  InstantEvalQueryJudging,
  InstantEvalQueryJudgingInput,
} from "@langwatch/instant-eval-contract";
import type { InstantEvalPricing } from "@langwatch/instant-eval-judge-contract";
import { instantEvalCostUsd, instantEvalPriceUsd } from "@langwatch/instant-eval-judge-contract";
import { createLogger } from "@langwatch/observability";
import { nowInstant, type Instant } from "@langwatch/time";

import { instantEvalRunQuestions } from "../rules/instant-eval-run-questions.rules.ts";
import { instantEvalQueryReservationId } from "../rules/instant-eval-spend-outcome.rules.ts";
import type { InstantEvalFreeBudgetService } from "./instant-eval-free-budget.service.ts";
import type {
  InstantEvalJudgeRowsService,
  InstantEvalJudgeUsage,
} from "./instant-eval-judge-rows.service.ts";
import type { InstantEvalJudgedSpendService } from "./instant-eval-judged-spend.service.ts";

const logger = createLogger("langwatch:instant-eval:query-judging");

export class InstantEvalQueryJudgingService {
  private constructor(
    private readonly options: {
      rows: Pick<InstantEvalJudgeRowsService, "judgeRows">;
      budget: Pick<InstantEvalFreeBudgetService, "reserve" | "release">;
      spend: Pick<InstantEvalJudgedSpendService, "recordSpend">;
      pricing: InstantEvalPricing;
      queryTokenBudget: number;
      now: () => Instant;
    },
  ) {}

  static create({
    rows,
    budget,
    spend,
    pricing,
    queryTokenBudget,
    now = nowInstant,
  }: {
    rows: Pick<InstantEvalJudgeRowsService, "judgeRows">;
    budget: Pick<InstantEvalFreeBudgetService, "reserve" | "release">;
    spend: Pick<InstantEvalJudgedSpendService, "recordSpend">;
    pricing: InstantEvalPricing;
    /** Input tokens one query may send: the ceiling it is held at and refused past. */
    queryTokenBudget: number;
    now?: () => Instant;
  }): InstantEvalQueryJudgingService {
    return new InstantEvalQueryJudgingService({
      rows,
      budget,
      spend,
      pricing,
      queryTokenBudget,
      now,
    });
  }

  /** Holds, judges, records once, releases; a statement asking nothing touches none of it. */
  async judgeQuery({
    projectId,
    judgements,
    rows,
    signal,
  }: InstantEvalQueryJudgingInput): Promise<InstantEvalQueryJudging> {
    const questions = instantEvalRunQuestions(judgements);
    if (questions.length === 0) return { rows, skipped: {} };

    const { budget, queryTokenBudget } = this.options;
    const reservationId = instantEvalQueryReservationId();
    await budget.reserve({ projectId, reservationId, priceUsd: this.#priceOf(queryTokenBudget) });
    let isRecorded = true;
    try {
      const judged = await this.options.rows.judgeRows({
        projectId,
        rows,
        questions,
        tokenBudget: queryTokenBudget,
        signal: signal ?? null,
      });
      // Recorded before a cancel is answered: what was judged was paid for.
      isRecorded = await this.#recordSpend({ projectId, usage: judged.usage });

      return {
        rows: judged.rows,
        skipped: judged.usage.skipped,
        ...(judged.cancellation ? { cancellation: judged.cancellation } : {}),
      };
    } finally {
      await this.#settle({ projectId, reservationId, isRecorded });
    }
  }

  #priceOf(inputTokens: number): number {
    const { pricing } = this.options;

    return instantEvalPriceUsd({ costUsd: instantEvalCostUsd({ inputTokens, pricing }), pricing });
  }

  /**
   * Nothing for a query that judged no text: a zero row is one a customer has to dismiss. Never
   * fails the query: the answer is correct and paid for, so a lost row is a log line.
   */
  async #recordSpend({
    projectId,
    usage,
  }: {
    projectId: string;
    usage: InstantEvalJudgeUsage;
  }): Promise<boolean> {
    if (usage.inputTokens <= 0) return true;
    try {
      await this.options.spend.recordSpend({
        projectId,
        inputTokens: usage.inputTokens,
        requests: usage.requests,
        occurredAt: this.options.now(),
      });

      return true;
    } catch (error) {
      logger.error({ projectId, error }, "Instant Evals query spend could not be recorded");

      return false;
    }
  }

  /** The hold goes once the spend it stood for is on the ledger; otherwise it stands in for it. */
  async #settle({
    projectId,
    reservationId,
    isRecorded,
  }: {
    projectId: string;
    reservationId: string;
    isRecorded: boolean;
  }): Promise<void> {
    if (isRecorded) {
      await this.options.budget.release({ projectId, reservationId });

      return;
    }
    logger.warn(
      { projectId, reservationId },
      "Instant Evals spend was not recorded; its hold on the free budget stays until it lapses",
    );
  }
}
