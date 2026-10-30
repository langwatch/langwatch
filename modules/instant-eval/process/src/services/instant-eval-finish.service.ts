/**
 * What a run cost, recorded once, whatever ended it. A recorder that fails is
 * raised: the finish intent retries onto the same request id.
 * @see modules/instant-eval/specs/instant-eval-billing.feature
 */

import type { InstantEvalOutcome } from "@langwatch/instant-eval-contract";
import type { InstantEvalPricing } from "@langwatch/instant-eval-judge-contract";
import {
  instantEvalPriceUsd,
  isInstantEvalSpendBillable,
  pickInstantEvalRoutedSpend,
  instantEvalSpentCostUsd,
} from "@langwatch/instant-eval-judge-contract";
import { createLogger } from "@langwatch/observability";
import { nowInstant, type Instant } from "@langwatch/time";

import type { InstantEvalSpend } from "../eventing/instant-eval-processing.intent.ts";
import type { InstantEvalFreeBudgetService } from "./instant-eval-free-budget.service.ts";
import type { InstantEvalJudgedSpendService } from "./instant-eval-judged-spend.service.ts";

const logger = createLogger("langwatch:instant-eval:finish");

export class InstantEvalFinishService {
  private readonly spend: Pick<InstantEvalJudgedSpendService, "recordSpend">;
  private readonly budget: Pick<InstantEvalFreeBudgetService, "release">;
  private readonly pricing: InstantEvalPricing;
  private readonly now: () => Instant;

  private constructor(options: {
    spend: Pick<InstantEvalJudgedSpendService, "recordSpend">;
    budget: Pick<InstantEvalFreeBudgetService, "release">;
    pricing: InstantEvalPricing;
    now: () => Instant;
  }) {
    this.spend = options.spend;
    this.budget = options.budget;
    this.pricing = options.pricing;
    this.now = options.now;
  }

  static create({
    spend,
    budget,
    pricing,
    now = nowInstant,
  }: {
    spend: Pick<InstantEvalJudgedSpendService, "recordSpend">;
    budget: Pick<InstantEvalFreeBudgetService, "release">;
    /** The judge's own published rates, which are what the run is priced at. */
    pricing: InstantEvalPricing;
    now?: () => Instant;
  }): InstantEvalFinishService {
    return new InstantEvalFinishService({ spend, budget, pricing, now });
  }

  async finish({
    runId,
    projectId,
    outcome,
    inputTokens,
    requests,
    costNanoUsd = 0,
    routedInputTokens = 0,
  }: {
    runId: string;
    projectId: string;
    outcome: InstantEvalOutcome;
    inputTokens: number;
    requests: number;
    /** A routed run's summed cost, and the input tokens it covers; none prices the tokens. */
    costNanoUsd?: number;
    routedInputTokens?: number;
  }): Promise<InstantEvalSpend> {
    const { pricing } = this;
    const costUsd = instantEvalSpentCostUsd({
      inputTokens,
      costNanoUsd,
      routedInputTokens,
      pricing,
    });
    const priceUsd = instantEvalPriceUsd({ costUsd, pricing });

    // A run that judged no row records no spend: a record of zero is one a
    // customer has to read and dismiss. A routed cost with no input tokens is billed.
    if (isInstantEvalSpendBillable({ inputTokens, costNanoUsd })) {
      await this.spend.recordSpend({
        projectId,
        runId,
        inputTokens,
        requests,
        ...pickInstantEvalRoutedSpend({ costNanoUsd, routedInputTokens }),
        occurredAt: this.now(),
      });
      logger.debug(
        { projectId, runId, outcome, costUsd, priceUsd },
        "Instant Eval run spend recorded",
      );
    }

    // After the spend is recorded, never before: a hold released ahead of a
    // recorder that then fails would let the retry find the budget already
    // handed to someone else.
    await this.budget.release({ projectId, reservationId: runId });

    return { costUsd, priceUsd };
  }
}
