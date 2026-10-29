import type { EventingCommands } from "@langwatch/eventing";
import {
  INSTANT_EVAL_JUDGE_DEFAULT_ROUTE_PRICING,
  INSTANT_EVAL_JUDGE_DEFAULT_ROUTE_TABLE,
  type InstantEvalClassification,
  instantEvalJudgeConfig,
  type InstantEvalJudgeAnswer,
  type InstantEvalJudgeBackendKind,
  type InstantEvalJudgeRoutePricing,
  type InstantEvalJudgeRouteTable,
  InstantEvalJudgeApi,
  type InstantEvalJudgeCall,
  type InstantEvalJudgeLedgerSpend,
  type InstantEvalJudgeLedgerSpendCopy,
  type InstantEvalJudgeServerConfig,
  type InstantEvalJudgeSpendRecord,
  type InstantEvalJudgement,
  type InstantEvalPricing,
  isLangWatchJudgeHost,
} from "@langwatch/instant-eval-judge-contract";
import { generate } from "@langwatch/ksuid";
import type { FeatureSetup } from "@langwatch/process";
import { nowInstant } from "@langwatch/time";

import {
  classifierApiKey,
  type InstantEvalClassifierChannel,
  type InstantEvalRateLimiter,
} from "../channels/instant-eval-classifier.channel.ts";
import { hostedDecisionsApiKey } from "../channels/instant-eval-hosted-decisions.channel.ts";
import type { InstantEvalJudgeChannels } from "../channels/instant-eval-judge.channels.ts";
import {
  llmJudgeAnthropicApiKey,
  llmJudgeOpenAiApiKey,
} from "../channels/instant-eval-llm-judge.channel.ts";
import {
  buildInstantEvalJudgeFactsPipeline,
  type InstantEvalJudgeFactsPipeline,
} from "../eventing/instant-eval-judge-facts.pipeline.ts";
import {
  buildInstantEvalJudgeSpendPipeline,
  type InstantEvalJudgeSpendPipeline,
} from "../eventing/instant-eval-judge-spend.pipeline.ts";
import type { InstantEvalJudgeRepositories } from "../repositories/instant-eval-judge.repositories.ts";
import {
  instantEvalJudgeQueryHoldPricingOf,
  instantEvalJudgeRouteBootIssues,
} from "../rules/instant-eval-judge-route-boot.rules.ts";
import { InstantEvalJudgeFactsService } from "../services/instant-eval-judge-facts.service.ts";
import { InstantEvalJudgeRouterService } from "../services/instant-eval-judge-router.service.ts";
import { InstantEvalJudgeService } from "../services/instant-eval-judge.service.ts";
import { InstantEvalRateLimiterService } from "../services/instant-eval-rate-limiter.service.ts";

type InstantEvalJudgeSetup = FeatureSetup<
  typeof InstantEvalJudgeModule.dependencies,
  InstantEvalJudgeServerConfig,
  InstantEvalJudgeRepositories,
  InstantEvalJudgeChannels
>;

/** Seconds of refill a bucket holds as burst, at the sustained rate. */
const BUCKET_BURST_SECONDS = 2;

/** The KSUID resource a judge call with no retry key mints its spend id under. */
const INSTANT_EVAL_JUDGE_KSUID_RESOURCE = "instantevaljudge";

/**
 * The Instant Evals judge, a dependency leaf with no peer Api (ADR-174 decision 13). It owns the
 * cloud classifier and its settings, folds the facts its judge call checks, and records each
 * priced call as its own fact.
 */
export class InstantEvalJudgeModule implements InstantEvalJudgeApi {
  static readonly contract = InstantEvalJudgeApi;
  static readonly dependencies = {};
  static readonly config = instantEvalJudgeConfig;
  /** LangWatch's classifier and router keys, read only where LangWatch runs the install. */
  static readonly secrets = {
    classifierApiKey,
    hostedDecisionsApiKey,
    llmJudgeAnthropicApiKey,
    llmJudgeOpenAiApiKey,
  } as const;

  readonly #facts: InstantEvalJudgeFactsService;
  readonly #classifier: InstantEvalClassifierChannel | undefined;
  readonly #judge: InstantEvalJudgeService;
  readonly #queryHoldPricing: InstantEvalPricing;
  #spendCommands: EventingCommands<InstantEvalJudgeSpendPipeline> | undefined;

  private constructor(setup: InstantEvalJudgeSetup) {
    const { classifier, decisionModels } = setup.channels;
    this.#facts = InstantEvalJudgeFactsService.create({ repositories: setup.repositories });
    this.#classifier = classifier;
    const limiter = InstantEvalJudgeModule.limiterOf(setup);
    const routePricing = setup.config.judgeRoutePricing ?? INSTANT_EVAL_JUDGE_DEFAULT_ROUTE_PRICING;
    const routeTable = setup.config.judgeRoutes ?? INSTANT_EVAL_JUDGE_DEFAULT_ROUTE_TABLE;
    InstantEvalJudgeModule.assertRoutable({ setup, table: routeTable, pricing: routePricing });
    this.#queryHoldPricing = instantEvalJudgeQueryHoldPricingOf({
      table: routeTable,
      pricing: routePricing,
    });
    const router = InstantEvalJudgeRouterService.create({
      table: routeTable,
      pricing: routePricing,
      classifier,
      hostedDecisions: setup.channels.hostedDecisions,
      llmJudge: setup.channels.llmJudge,
      limiter,
    });
    this.#judge = InstantEvalJudgeService.create({
      router,
      routePricing,
      repositories: setup.repositories,
      classifier,
      decisionModels,
      limiter,
      isCloud: isLangWatchJudgeHost(setup.config),
      recordSpendPriced: async (fact) => {
        if (!this.#spendCommands) {
          throw new Error("the Instant Evals judge spend pipeline is not connected");
        }
        await this.#spendCommands.recordSpendPriced.send(fact);
      },
      mintRequestId: () => generate(INSTANT_EVAL_JUDGE_KSUID_RESOURCE).toString(),
      now: nowInstant,
    });
  }

  static async create(setup: InstantEvalJudgeSetup): Promise<InstantEvalJudgeModule> {
    const { classifier } = setup.channels;
    if (classifier) {
      setup.resources.own(
        "Instant Evals classifier",
        () => classifier.close?.() ?? Promise.resolve(),
      );
    }
    return new InstantEvalJudgeModule(setup);
  }

  /**
   * Refuses to boot on a route table it cannot bill or call: every backend a slot can reach needs
   * a price and, for a configured table, this install's key and channel for its kind.
   */
  private static assertRoutable({
    setup,
    table,
    pricing,
  }: {
    setup: InstantEvalJudgeSetup;
    table: InstantEvalJudgeRouteTable;
    pricing: InstantEvalJudgeRoutePricing;
  }): void {
    const { classifier, hostedDecisions, llmJudge } = setup.channels;
    const isHeld = (kind: InstantEvalJudgeBackendKind): boolean => {
      if (kind === "jev") return classifier !== undefined;
      if (kind === "decisions") return hostedDecisions !== undefined;
      return llmJudge.isConfigured(kind);
    };
    const issues = instantEvalJudgeRouteBootIssues({
      table,
      pricing,
      ...(setup.config.judgeRoutes ? { isHeld } : {}),
    });
    if (issues.length === 0) return;
    throw new Error(
      `INSTANT_EVAL_JUDGE_ROUTES and INSTANT_EVAL_JUDGE_PRICING cannot route: ${issues.join("; ")}`,
    );
  }

  private static limiterOf({
    config,
    repositories,
  }: InstantEvalJudgeSetup): InstantEvalRateLimiter {
    const tokensPerSecond = config.globalTokensPerSecond;
    const tenantTokensPerSecond = Math.min(tokensPerSecond, config.tenantTokensPerSecond);
    return InstantEvalRateLimiterService.create({
      buckets: repositories.rateLimits,
      tokensPerSecond,
      capacity: tokensPerSecond * BUCKET_BURST_SECONDS,
      tenantTokensPerSecond,
      tenantCapacity: tenantTokensPerSecond * BUCKET_BURST_SECONDS,
    });
  }

  async isClassifierConfigured(): Promise<boolean> {
    return this.#classifier !== undefined;
  }

  async queryHoldPricing(): Promise<InstantEvalPricing> {
    return this.#queryHoldPricing;
  }

  classify(input: InstantEvalClassification): Promise<InstantEvalJudgement> {
    return this.#judge.classifyOnce(input);
  }

  judge(input: InstantEvalJudgeCall): Promise<InstantEvalJudgeAnswer> {
    return this.#judge.judge(input);
  }

  recordSpend(input: InstantEvalJudgeSpendRecord): Promise<void> {
    return this.#judge.recordSpend(input);
  }

  copyLedgerSpend(input: InstantEvalJudgeLedgerSpend): Promise<InstantEvalJudgeLedgerSpendCopy> {
    return this.#facts.copyLedgerSpend(input);
  }

  factsPipeline(): InstantEvalJudgeFactsPipeline {
    return buildInstantEvalJudgeFactsPipeline({ facts: this.#facts });
  }

  spendPipeline(): InstantEvalJudgeSpendPipeline {
    return buildInstantEvalJudgeSpendPipeline({ facts: this.#facts });
  }

  /** Binds the spend pipeline's own senders; every priced fact goes through them. */
  connectSpendCommands(commands: EventingCommands<InstantEvalJudgeSpendPipeline>): void {
    this.#spendCommands = commands;
  }
}
