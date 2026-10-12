/**
 * One metered judge call (ADR-174 decisions 8, 10, 14, 15), in a fixed order: cloud only,
 * unknown project, budget, classify, price, priced fact. A refusal is returned, never thrown, and
 * calls no classifier. Spec: modules/instant-eval/specs/instant-eval-judge-model.feature
 */

import {
  INSTANT_EVAL_FREE_BUDGET_USD,
  InstantEvalFreeBudgetExhaustedError,
  type InstantEvalJudgeAnswer,
  type InstantEvalJudgeCall,
  type InstantEvalJudgeRefusalCode,
  type InstantEvalJudgeSpendPricedEventData,
  type InstantEvalJudgeSpendRecord,
  type InstantEvalPricing,
} from "@langwatch/instant-eval-judge-contract";
import { createLogger, type Logger } from "@langwatch/observability";
import type { Instant } from "@langwatch/time";

import type {
  InstantEvalClassifierChannel,
  InstantEvalRateLimiter,
} from "../channels/instant-eval-classifier.channel.ts";
import type { InstantEvalJudgeRepositories } from "../repositories/instant-eval-judge.repositories.ts";
import { instantEvalJudgeBudgetOf } from "../rules/instant-eval-judge-budget.rules.ts";
import {
  instantEvalJudgeSpendPricedOf,
  instantEvalJudgeSpendRequestId,
} from "../rules/instant-eval-judge-spend.rules.ts";

const defaultLogger: Logger = createLogger("langwatch:instant-eval-judge:judge");

/** The two levels the judge call logs at, injected so a test can read them. */
type InstantEvalJudgeLogger = Pick<Logger, "warn" | "error">;

const PROJECT_UNKNOWN_MESSAGE =
  "Instant Evals has not learned this project yet, so it judged nothing.";
const NOT_CONFIGURED_MESSAGE =
  "Instant Evals judges only on LangWatch cloud, so this installation judged nothing.";

type InstantEvalJudgeServiceDeps = Readonly<{
  repositories: Pick<InstantEvalJudgeRepositories, "projects" | "usageBilling" | "spend">;
  /** LangWatch's own classifier; absent where the deployment holds no key. */
  classifier: InstantEvalClassifierChannel | undefined;
  /** Paces every classify send over the module's own rate buckets. */
  limiter: InstantEvalRateLimiter;
  /** LangWatch cloud, the only install a judge call is answered on. */
  isCloud: boolean;
  /** Appends the priced fact; the judge's spend row and gateway's ledger row follow from it. */
  recordSpendPriced: (fact: InstantEvalJudgeSpendPricedEventData) => Promise<void>;
  mintRequestId: () => string;
  now: () => Instant;
  /** The published rates; a test names its own so a price comes out round. */
  pricing?: InstantEvalPricing;
  logger?: InstantEvalJudgeLogger;
}>;

export class InstantEvalJudgeService {
  private readonly logger: InstantEvalJudgeLogger;

  private constructor(private readonly deps: InstantEvalJudgeServiceDeps) {
    this.logger = deps.logger ?? defaultLogger;
  }

  static create(deps: InstantEvalJudgeServiceDeps): InstantEvalJudgeService {
    return new InstantEvalJudgeService(deps);
  }

  async judge({
    projectId,
    text,
    questions,
    requestKey,
    signal,
  }: InstantEvalJudgeCall): Promise<InstantEvalJudgeAnswer> {
    // Off cloud nothing judges, so the project's placement is never the reason to give.
    const { classifier } = this.deps;
    if (!this.deps.isCloud || !classifier) {
      return refused({ code: "classifier_not_configured", message: NOT_CONFIGURED_MESSAGE });
    }
    const placement = await this.deps.repositories.projects.getPlacement({ projectId });
    if (placement.outcome === "unknown") {
      // The project catch-up teaches it: the log names the job, so the gap shows on first refusal.
      this.logger.warn(
        { projectId },
        "Instant Evals judge refused a project it has not learned; re-run backfill-project-created",
      );
      return refused({ code: "instant_eval_project_unknown", message: PROJECT_UNKNOWN_MESSAGE });
    }

    const { organizationId } = placement;
    const budget = await this.budgetOf({ organizationId });
    if (budget.outcome === "exhausted") {
      const { message } = new InstantEvalFreeBudgetExhaustedError({
        spentUsd: budget.spentUsd,
        budgetUsd: INSTANT_EVAL_FREE_BUDGET_USD,
      });
      return refused({ code: "instant_eval_free_budget_exhausted", message });
    }

    const judgement = await classifier.classify(
      { projectId, text, questions, limiter: this.deps.limiter },
      ...(signal ? [signal] : []),
    );
    // A skip billed nothing, so it records nothing.
    if (judgement.inputTokens <= 0) return { outcome: "judged", judgement, priceUsd: 0 };

    const { priceUsd, fact } = instantEvalJudgeSpendPricedOf({
      organizationId,
      projectId,
      requestId: instantEvalJudgeSpendRequestId({
        requestKey,
        mint: this.deps.mintRequestId,
      }),
      inputTokens: judgement.inputTokens,
      occurredAt: this.deps.now().epochMilliseconds,
      ...this.pricing(),
    });
    await this.record({ fact });
    return { outcome: "judged", judgement, priceUsd };
  }

  /**
   * A run's or judged query's spend, under the organization its caller resolved: no project
   * placement and no budget is read here, since runs keep their own $1 check (decision 12).
   * A fact that cannot be stored throws, so a run's finish retries onto the same request id.
   */
  async recordSpend({
    organizationId,
    projectId,
    requestId,
    inputTokens,
    requests,
    runId,
    occurredAt,
  }: InstantEvalJudgeSpendRecord): Promise<void> {
    if (inputTokens <= 0) return;
    const { fact } = instantEvalJudgeSpendPricedOf({
      organizationId,
      projectId,
      requestId,
      inputTokens,
      occurredAt,
      requests,
      runId,
      ...this.pricing(),
    });
    await this.deps.recordSpendPriced(fact);
  }

  private pricing(): { pricing?: InstantEvalPricing } {
    return this.deps.pricing ? { pricing: this.deps.pricing } : {};
  }

  /** Only the judge call reads the usage-billing copy; an organization never folded is capped. */
  private async budgetOf({ organizationId }: { organizationId: string }) {
    const { usageBilling, spend } = this.deps.repositories;
    const [billing, total] = await Promise.all([
      usageBilling.getUsageBilling({ organizationId }),
      spend.getTotal({ organizationId }),
    ]);
    return instantEvalJudgeBudgetOf({
      usageBilled: billing.outcome === "folded" && billing.fact.usageBilled,
      spentNanoUsd: total.spendNanoUsd,
    });
  }

  /**
   * The classifier was paid, so a cancelled caller still records. A fact that cannot be appended
   * is logged and the verdict kept, as a judged query does today (ADR-174 decision 8).
   */
  private async record({ fact }: { fact: InstantEvalJudgeSpendPricedEventData }): Promise<void> {
    try {
      await this.deps.recordSpendPriced(fact);
    } catch (error) {
      this.logger.error(
        {
          error,
          organizationId: fact.organizationId,
          projectId: fact.projectId,
          requestId: fact.requestId,
          priceNanoUsd: fact.priceNanoUsd,
        },
        "Instant Evals judge spend could not be recorded; the verdict is kept",
      );
    }
  }
}

function refused({
  code,
  message,
}: {
  code: InstantEvalJudgeRefusalCode;
  message: string;
}): InstantEvalJudgeAnswer {
  return { outcome: "refused", code, message };
}
