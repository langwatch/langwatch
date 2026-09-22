/**
 * What a run cost, recorded once, whatever ended it. A recorder that fails is
 * raised: the finish intent retries onto the same request id.
 * @see specs/instant-evals/instant-eval-billing.feature
 */

import type { InstantEvalOutcome, InstantEvalPricing } from "@langwatch/instant-eval-contract";
import { createLogger } from "@langwatch/observability";
import { nowInstant, toDate, type Instant } from "@langwatch/time";

import type { InstantEvalSpend } from "../eventing/instant-eval-processing.intent.ts";
import { instantEvalCostUsd, instantEvalPriceUsd } from "../rules/instant-eval-pricing.rules.ts";
import type { InstantEvalFreeBudgetService } from "./instant-eval-free-budget.service.ts";
import type { InstantEvalSpendService } from "./instant-eval-spend.service.ts";

const logger = createLogger("langwatch:instant-eval:finish");

export class InstantEvalFinishService {
  private constructor(
    private readonly spend: Pick<InstantEvalSpendService, "recordSpend">,
    private readonly budget: Pick<InstantEvalFreeBudgetService, "release">,
    private readonly pricing: InstantEvalPricing,
    private readonly now: () => Instant,
  ) {}

  static create({
    spend,
    budget,
    pricing,
    now = nowInstant,
  }: {
    spend: Pick<InstantEvalSpendService, "recordSpend">;
    budget: Pick<InstantEvalFreeBudgetService, "release">;
    /** The judge's own published rates, which are what the run is priced at. */
    pricing: InstantEvalPricing;
    now?: () => Instant;
  }): InstantEvalFinishService {
    return new InstantEvalFinishService(spend, budget, pricing, now);
  }

  async finish({
    runId,
    projectId,
    outcome,
    inputTokens,
    requests,
  }: {
    runId: string;
    projectId: string;
    outcome: InstantEvalOutcome;
    inputTokens: number;
    requests: number;
  }): Promise<InstantEvalSpend> {
    const costUsd = instantEvalCostUsd({ inputTokens, pricing: this.pricing });
    const priceUsd = instantEvalPriceUsd({ costUsd, pricing: this.pricing });

    // A run that judged no row records no spend: a record of zero is one a
    // customer has to read and dismiss.
    if (inputTokens > 0) {
      await this.spend.recordSpend({
        projectId,
        runId,
        inputTokens,
        requests,
        costUsd,
        priceUsd,
        occurredAt: toDate(this.now()),
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
