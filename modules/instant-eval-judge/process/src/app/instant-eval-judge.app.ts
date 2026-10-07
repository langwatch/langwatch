import { InstantEvalJudgeApi } from "@langwatch/instant-eval-judge-contract";
import type { FeatureSetup } from "@langwatch/process";

import {
  buildInstantEvalJudgeFactsPipeline,
  type InstantEvalJudgeFactsPipeline,
} from "../eventing/instant-eval-judge-facts.pipeline.ts";
import type { InstantEvalJudgeRepositories } from "../repositories/instant-eval-judge.repositories.ts";
import { InstantEvalJudgeFactsService } from "../services/instant-eval-judge-facts.service.ts";

type InstantEvalJudgeSetup = FeatureSetup<
  typeof InstantEvalJudgeModule.dependencies,
  never,
  undefined,
  InstantEvalJudgeRepositories
>;

/**
 * The Instant Evals judge, a dependency leaf with no peer Api (ADR-174 decision 13). Today it only
 * folds the facts its judge call will check; the call lands with ADR-174 decision 10.
 */
export class InstantEvalJudgeModule implements InstantEvalJudgeApi {
  static readonly contract = InstantEvalJudgeApi;
  static readonly dependencies = {};

  readonly #facts: InstantEvalJudgeFactsService;

  private constructor({ facts }: { facts: InstantEvalJudgeFactsService }) {
    this.#facts = facts;
  }

  static create({ repositories }: InstantEvalJudgeSetup): InstantEvalJudgeModule {
    return new InstantEvalJudgeModule({
      facts: InstantEvalJudgeFactsService.create({ repositories }),
    });
  }

  factsPipeline(): InstantEvalJudgeFactsPipeline {
    return buildInstantEvalJudgeFactsPipeline({ facts: this.#facts });
  }
}
