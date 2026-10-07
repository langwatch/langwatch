import type { EventingCommands } from "@langwatch/eventing";
import {
  type InstantEvalClassification,
  instantEvalJudgeConfig,
  type InstantEvalJudgeAnswer,
  InstantEvalJudgeApi,
  type InstantEvalJudgeCall,
  type InstantEvalJudgeLedgerSpend,
  type InstantEvalJudgeLedgerSpendCopy,
  type InstantEvalJudgeServerConfig,
  type InstantEvalJudgeSpendRecord,
  type InstantEvalJudgement,
  instantEvalSkipped,
} from "@langwatch/instant-eval-judge-contract";
import { generate } from "@langwatch/ksuid";
import type { FeatureSetup } from "@langwatch/process";
import { Secret } from "@langwatch/secrets";
import { nowInstant } from "@langwatch/time";

import { instantEvalClassifierChannels } from "../channels/instant-eval-classifier-channels.registry.ts";
import type { InstantEvalClassifierChannel } from "../channels/instant-eval-classifier.channel.ts";
import {
  buildInstantEvalJudgeFactsPipeline,
  type InstantEvalJudgeFactsPipeline,
} from "../eventing/instant-eval-judge-facts.pipeline.ts";
import {
  buildInstantEvalJudgeSpendPipeline,
  type InstantEvalJudgeSpendPipeline,
} from "../eventing/instant-eval-judge-spend.pipeline.ts";
import type { InstantEvalJudgeRepositories } from "../repositories/instant-eval-judge.repositories.ts";
import { cloudClassifierKeyOf } from "../rules/instant-eval-judge-cloud-key.rules.ts";
import { InstantEvalJudgeFactsService } from "../services/instant-eval-judge-facts.service.ts";
import { InstantEvalJudgeService } from "../services/instant-eval-judge.service.ts";
import { InstantEvalRateLimiterService } from "../services/instant-eval-rate-limiter.service.ts";

type InstantEvalJudgeSetup = FeatureSetup<
  typeof InstantEvalJudgeModule.dependencies,
  never,
  InstantEvalJudgeServerConfig,
  InstantEvalJudgeRepositories
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
  /** LangWatch's own classifier key, read on LangWatch Cloud only; elsewhere nothing classifies. */
  static readonly secrets = {
    classifierApiKey: Secret.load("JEV_API_KEY", { optional: true }),
  } as const;

  readonly #facts: InstantEvalJudgeFactsService;
  readonly #classifier: InstantEvalClassifierChannel | undefined;
  readonly #judge: InstantEvalJudgeService;
  #spendCommands: EventingCommands<InstantEvalJudgeSpendPipeline> | undefined;

  private constructor({
    setup,
    classifier,
  }: {
    setup: InstantEvalJudgeSetup;
    classifier: InstantEvalClassifierChannel | undefined;
  }) {
    this.#facts = InstantEvalJudgeFactsService.create({ repositories: setup.repositories });
    this.#classifier = classifier;
    this.#judge = InstantEvalJudgeService.create({
      repositories: setup.repositories,
      classifier,
      isCloud: setup.config.isSaas,
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
    return setup.secrets.into(InstantEvalJudgeModule.secrets.classifierApiKey, (secretKey) => {
      const apiKey = cloudClassifierKeyOf({ isCloud: setup.config.isSaas, apiKey: secretKey });
      const classifier = apiKey ? InstantEvalJudgeModule.classifierOf({ setup, apiKey }) : void 0;
      if (classifier) {
        setup.resources.own(
          "Instant Evals classifier",
          () => classifier.close?.() ?? Promise.resolve(),
        );
      }
      return new InstantEvalJudgeModule({ setup, classifier });
    });
  }

  private static classifierOf({
    setup,
    apiKey,
  }: {
    setup: InstantEvalJudgeSetup;
    apiKey: string;
  }): InstantEvalClassifierChannel {
    const { config } = setup;
    const tokensPerSecond = config.globalTokensPerSecond;
    const tenantTokensPerSecond = Math.min(tokensPerSecond, config.tenantTokensPerSecond);
    return instantEvalClassifierChannels.live.create({
      apiKey,
      ...(config.classifierBaseUrl ? { baseUrl: config.classifierBaseUrl } : {}),
      ...(config.classifierModel ? { model: config.classifierModel } : {}),
      limiter: InstantEvalRateLimiterService.create({
        buckets: setup.repositories.rateLimits,
        tokensPerSecond,
        capacity: tokensPerSecond * BUCKET_BURST_SECONDS,
        tenantTokensPerSecond,
        tenantCapacity: tenantTokensPerSecond * BUCKET_BURST_SECONDS,
      }),
    });
  }

  async isClassifierConfigured(): Promise<boolean> {
    return this.#classifier !== undefined;
  }

  async classify({
    projectId,
    text,
    questions,
    signal,
  }: InstantEvalClassification): Promise<InstantEvalJudgement> {
    if (!this.#classifier) return instantEvalSkipped("classifier_not_configured");
    return this.#classifier.classify({ projectId, text, questions }, ...(signal ? [signal] : []));
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
