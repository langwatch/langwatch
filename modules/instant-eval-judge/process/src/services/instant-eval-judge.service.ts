/**
 * One metered judge call (ADR-174 decisions 8, 10, 14, 15): cloud only, unknown project, budget,
 * classify, price, priced fact; a refusal is returned. An own model skips all but the call (ADR-182
 * decision 7). Spec: modules/instant-eval/specs/instant-eval-judge-model.feature
 */

import {
  INSTANT_EVAL_FREE_BUDGET_USD,
  InstantEvalFreeBudgetExhaustedError,
  InstantEvalJudgeStoppedError,
  instantEvalSkipped,
  type InstantEvalClassification,
  type InstantEvalJudgeAnswer,
  type InstantEvalJudgeCall,
  type InstantEvalJudgement,
  type InstantEvalJudgeRefusalCode,
  type InstantEvalJudgeRoutePricing,
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
import type { InstantEvalDecisionModelChannel } from "../channels/instant-eval-decision-model.channel.ts";
import type { InstantEvalJudgeRepositories } from "../repositories/instant-eval-judge.repositories.ts";
import { instantEvalJudgeBudgetOf } from "../rules/instant-eval-judge-budget.rules.ts";
import {
  instantEvalJudgeSpendPricedOf,
  instantEvalJudgeSpendRequestId,
} from "../rules/instant-eval-judge-spend.rules.ts";
import type { InstantEvalJudgeRouterService } from "./instant-eval-judge-router.service.ts";

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
  /** An organization's own decision model, unmetered and uncapped (ADR-182 decision 7). */
  decisionModels: InstantEvalDecisionModelChannel;
  /** Paces every classify send over the module's own rate buckets. */
  limiter: InstantEvalRateLimiter;
  /** Answers a call that carries a route. */
  router: InstantEvalJudgeRouterService;
  /** The router's prices; a routed spend is priced from its cost at this markup. */
  routePricing: InstantEvalJudgeRoutePricing;
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

  /**
   * One unmetered classify, the one dispatch `judge` and the Api's `classify` share: an own
   * decision model, else the router for a routed call, else LangWatch's classifier, else a skip.
   */
  async classifyOnce({
    projectId,
    text,
    questions,
    signal,
    decisionModel,
    route,
  }: InstantEvalClassification): Promise<InstantEvalJudgement> {
    const signalArgs = signal ? [signal] : [];
    if (decisionModel) {
      return this.deps.decisionModels.classify({ text, questions, decisionModel }, ...signalArgs);
    }
    const { classifier, limiter, router } = this.deps;
    if (!classifier) return instantEvalSkipped("classifier_not_configured");
    if (route) {
      return router.classify({ projectId, text, questions, route, ...(signal ? { signal } : {}) });
    }
    return classifier.classify({ projectId, text, questions, limiter }, ...signalArgs);
  }

  async judge({ requestKey, ...call }: InstantEvalJudgeCall): Promise<InstantEvalJudgeAnswer> {
    const { projectId, decisionModel } = call;
    if (decisionModel) {
      return { outcome: "judged", judgement: await this.classifyOnce(call), priceUsd: 0 };
    }
    // Off cloud nothing judges, so the project's placement is never the reason to give.
    if (!this.deps.isCloud || !this.deps.classifier) {
      return refused({ code: "classifier_not_configured", message: NOT_CONFIGURED_MESSAGE });
    }
    const placement = await this.deps.repositories.projects.getPlacement({ projectId });
    if (placement.outcome === "unknown") {
      // The project catch-up teaches it: the log names the job, so the gap shows on first refusal.
      this.logger.warn(
        { projectId },
        "Instant Evals judge refused a project it has not learned; retry the project:record-created-facts step in Ops",
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

    const spend = { organizationId, projectId, requestKey };
    const judgement = await this.classifyRecordingStop({ spend, call });
    // A skip billed nothing, so it records nothing.
    if (judgement.inputTokens <= 0) return { outcome: "judged", judgement, priceUsd: 0 };

    const { inputTokens, costNanoUsd } = judgement;
    const priceUsd = await this.priceAndRecord({ ...spend, inputTokens, costNanoUsd });
    return { outcome: "judged", judgement, priceUsd };
  }

  /** One classify; a routed stop after paid legs records what they spent, then is rethrown. */
  private async classifyRecordingStop({
    spend,
    call,
  }: {
    spend: Readonly<{ organizationId: string; projectId: string; requestKey?: string | undefined }>;
    call: InstantEvalClassification;
  }): Promise<InstantEvalJudgement> {
    try {
      return await this.classifyOnce(call);
    } catch (error) {
      if (error instanceof InstantEvalJudgeStoppedError) {
        const { inputTokens, costNanoUsd } = error;
        await this.priceAndRecord({ ...spend, inputTokens, costNanoUsd });
      }
      throw error;
    }
  }

  /** One paid call, priced and recorded. The router prices all it returns: a cost marks routed. */
  private async priceAndRecord({
    organizationId,
    projectId,
    requestKey,
    inputTokens,
    costNanoUsd,
  }: {
    organizationId: string;
    projectId: string;
    requestKey?: string | undefined;
    inputTokens: number;
    costNanoUsd: number | undefined;
  }): Promise<number> {
    const { priceUsd, fact } = instantEvalJudgeSpendPricedOf({
      organizationId,
      projectId,
      requestId: instantEvalJudgeSpendRequestId({
        requestKey,
        mint: this.deps.mintRequestId,
      }),
      inputTokens,
      occurredAt: this.deps.now().epochMilliseconds,
      ...this.pricing(),
      routed: this.routedOf({
        costNanoUsd: costNanoUsd ?? 0,
        routedInputTokens: costNanoUsd === undefined ? 0 : inputTokens,
      }),
    });
    await this.record({ fact });
    return priceUsd;
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
    costNanoUsd = 0,
    routedInputTokens = 0,
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
      routed: this.routedOf({ costNanoUsd, routedInputTokens }),
    });
    await this.deps.recordSpendPriced(fact);
  }

  /** Routed tokens price the spend from its routed cost; none prices the tokens as before. */
  private routedOf({
    costNanoUsd,
    routedInputTokens,
  }: {
    costNanoUsd: number;
    routedInputTokens: number;
  }) {
    if (routedInputTokens <= 0) return undefined;
    return { costNanoUsd, routedInputTokens, pricing: this.deps.routePricing };
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
