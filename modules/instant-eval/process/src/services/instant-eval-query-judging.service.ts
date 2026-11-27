/**
 * One synchronous LangWatchQL query's judging (Alex, 2026-10-06, "Judge cycle"): held, judged,
 * recorded once, released; an unrecorded spend keeps its hold until it lapses. A routed query is
 * held at its cost ceiling, where its sends stop (ADR-190 decision 13).
 * @see specs/lwql/eval-functions.feature
 */

import type {
  InstantEvalQueryJudging,
  InstantEvalQueryJudgingInput,
} from "@langwatch/instant-eval-contract";
import type {
  InstantEvalJudgeCostCeiling,
  InstantEvalJudgeRouteRequest,
  InstantEvalPricing,
} from "@langwatch/instant-eval-judge-contract";
import {
  INSTANT_EVAL_PRICING,
  NANO_USD_PER_USD,
  instantEvalCostUsd,
  instantEvalPriceUsd,
  instantEvalRoutedQueryCeilingNanoUsd,
  isInstantEvalSpendBillable,
  pickInstantEvalRoutedSpend,
} from "@langwatch/instant-eval-judge-contract";
import { createLogger } from "@langwatch/observability";
import { nowInstant, type Instant } from "@langwatch/time";

import { instantEvalRunQuestions } from "../rules/instant-eval-run-questions.rules.ts";
import { instantEvalQueryReservationId } from "../rules/instant-eval-spend-outcome.rules.ts";
import type { InstantEvalDecisionModelJudgeService } from "./instant-eval-decision-model-judge.service.ts";
import type { InstantEvalFreeBudgetService } from "./instant-eval-free-budget.service.ts";
import type { InstantEvalGatewayBudgetService } from "./instant-eval-gateway-budget.service.ts";
import type {
  InstantEvalJudgeRowsService,
  InstantEvalJudgeUsage,
} from "./instant-eval-judge-rows.service.ts";
import type { InstantEvalJudgedSpendService } from "./instant-eval-judged-spend.service.ts";
import { InstantEvalQueryCostCeilingService } from "./instant-eval-query-cost-ceiling.service.ts";
import type { InstantEvalSearchRoutingService } from "./instant-eval-search-routing.service.ts";

/** The route a routed judged query sends: the table picks its slot and mode. */
const SEARCH_ROUTE: InstantEvalJudgeRouteRequest = { job: "search" };

/** How one query is judged: unrouted, or routed under its cost ceiling. */
type InstantEvalQueryRouting =
  | Readonly<{ isRouted: false }>
  | Readonly<{ isRouted: true; costCeiling: InstantEvalJudgeCostCeiling; ceilingNanoUsd: number }>;

const logger = createLogger("langwatch:instant-eval:query-judging");

export class InstantEvalQueryJudgingService {
  private constructor(
    private readonly options: {
      rows: Pick<InstantEvalJudgeRowsService, "judgeRows">;
      budget: Pick<InstantEvalFreeBudgetService, "reserve" | "release">;
      gatewayBudget: Pick<InstantEvalGatewayBudgetService, "assertWithinGatewayBudget">;
      spend: Pick<InstantEvalJudgedSpendService, "recordSpend">;
      holdPricing: () => Promise<InstantEvalPricing>;
      queryTokenBudget: number;
      searchRouting: Pick<InstantEvalSearchRoutingService, "isRouted">;
      ownModels: Pick<InstantEvalDecisionModelJudgeService, "isOwnDecisionModel">;
      now: () => Instant;
    },
  ) {}

  static create({
    rows,
    budget,
    gatewayBudget,
    spend,
    holdPricing,
    queryTokenBudget,
    searchRouting,
    ownModels,
    now = nowInstant,
  }: {
    rows: Pick<InstantEvalJudgeRowsService, "judgeRows">;
    budget: Pick<InstantEvalFreeBudgetService, "reserve" | "release">;
    gatewayBudget: Pick<InstantEvalGatewayBudgetService, "assertWithinGatewayBudget">;
    spend: Pick<InstantEvalJudgedSpendService, "recordSpend">;
    /** The judge's hold rates: the dearest input rate a routed call could reach. */
    holdPricing: () => Promise<InstantEvalPricing>;
    /** Input tokens one query may send: the ceiling it is held at and refused past. */
    queryTokenBudget: number;
    /** Whether a project's queries send the search route, behind its own flag. */
    searchRouting: Pick<InstantEvalSearchRoutingService, "isRouted">;
    /** Whether a project judges on its own decision model, which never sends the route. */
    ownModels: Pick<InstantEvalDecisionModelJudgeService, "isOwnDecisionModel">;
    now?: () => Instant;
  }): InstantEvalQueryJudgingService {
    return new InstantEvalQueryJudgingService({
      rows,
      budget,
      gatewayBudget,
      spend,
      holdPricing,
      queryTokenBudget,
      searchRouting,
      ownModels,
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

    const { budget, gatewayBudget, queryTokenBudget } = this.options;
    await gatewayBudget.assertWithinGatewayBudget({ projectId });
    const reservationId = instantEvalQueryReservationId();
    const routing = await this.#routingOf({ projectId });
    const priceUsd = routing.isRouted
      ? this.#ceilingPriceOf(routing.ceilingNanoUsd)
      : await this.#holdPriceOf(queryTokenBudget);
    await budget.reserve({ projectId, reservationId, priceUsd });
    let isRecorded = true;
    try {
      const judged = await this.options.rows.judgeRows({
        projectId,
        rows,
        questions,
        tokenBudget: queryTokenBudget,
        signal: signal ?? null,
        ...(routing.isRouted ? { route: SEARCH_ROUTE, costCeiling: routing.costCeiling } : {}),
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

  /**
   * Routed behind the project's own flag, under a fresh ceiling for this query alone. A project on
   * its own decision model is never routed (ADR-190 decision 13), so it is not held at the ceiling.
   */
  async #routingOf({ projectId }: { projectId: string }): Promise<InstantEvalQueryRouting> {
    if (!(await this.options.searchRouting.isRouted({ projectId }))) return { isRouted: false };
    if (await this.options.ownModels.isOwnDecisionModel({ projectId })) return { isRouted: false };
    const ceilingNanoUsd = instantEvalRoutedQueryCeilingNanoUsd({
      queryTokenBudget: this.options.queryTokenBudget,
    });
    const costCeiling = InstantEvalQueryCostCeilingService.create({ ceilingNanoUsd });
    return { isRouted: true, costCeiling, ceilingNanoUsd };
  }

  /** A routed query's hold: its whole ceiling at the one markup, the most it can be charged. */
  #ceilingPriceOf(ceilingNanoUsd: number): number {
    return instantEvalPriceUsd({
      costUsd: ceilingNanoUsd / NANO_USD_PER_USD,
      pricing: INSTANT_EVAL_PRICING,
    });
  }

  /**
   * The token budget at the dearest base input rate a routed call could reach: an unrouted query's
   * hold, which no routed send reaches (ADR-190 decision 7).
   */
  async #holdPriceOf(inputTokens: number): Promise<number> {
    const pricing = await this.options.holdPricing();

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
    if (!isInstantEvalSpendBillable(usage)) return true;
    try {
      await this.options.spend.recordSpend({
        projectId,
        inputTokens: usage.inputTokens,
        requests: usage.requests,
        ...pickInstantEvalRoutedSpend(usage),
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
