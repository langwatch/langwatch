/**
 * Sends a project on its own decision model to the judge leaf with its key, and every other
 * project to the deployment's judge as before (ADR-182 decisions 6, 7 and 9). Model provider
 * keeps the answer a minute per project, so a page of rows reads the column once.
 * @see specs/model-providers/instant-evals-decision-model.feature
 */

import {
  instantEvalOwnDecisionModelOf,
  instantEvalSkipped,
  instantEvalUnavailableDecisionModelSkipOf,
  type InstantEvalJudgeApi,
  type InstantEvalJudgement,
} from "@langwatch/instant-eval-judge-contract";
import type { ModelProviderApi } from "@langwatch/model-provider-contract";

import type {
  InstantEvalClassifyRequest,
  InstantEvalJudgeChannel,
} from "../channels/instant-eval-judging.channel.ts";

export class InstantEvalDecisionModelJudgeService implements InstantEvalJudgeChannel {
  private constructor(
    private readonly options: Readonly<{
      hosted: InstantEvalJudgeChannel;
      own: Pick<InstantEvalJudgeApi, "classify">;
      decisionModels: Pick<ModelProviderApi, "resolveDecisionModel">;
    }>,
  ) {}

  static create({
    hosted,
    own,
    decisionModels,
  }: {
    hosted: InstantEvalJudgeChannel;
    own: Pick<InstantEvalJudgeApi, "classify">;
    decisionModels: Pick<ModelProviderApi, "resolveDecisionModel">;
  }): InstantEvalDecisionModelJudgeService {
    return new InstantEvalDecisionModelJudgeService({ hosted, own, decisionModels });
  }

  get limits(): InstantEvalJudgeChannel["limits"] {
    return this.options.hosted.limits;
  }

  get pricing(): InstantEvalJudgeChannel["pricing"] {
    return this.options.hosted.pricing;
  }

  async classify(
    request: InstantEvalClassifyRequest,
    signal?: AbortSignal,
  ): Promise<InstantEvalJudgement> {
    const resolved = await this.options.decisionModels.resolveDecisionModel({
      projectId: request.projectId,
    });
    if (resolved.kind === "langwatch") return this.options.hosted.classify(request, signal);
    if (resolved.kind === "own_unavailable") {
      // Never LangWatch's classifier in its place (ADR-182 decision 9).
      return instantEvalSkipped(instantEvalUnavailableDecisionModelSkipOf(resolved));
    }

    return this.options.own.classify({
      projectId: request.projectId,
      text: request.text,
      questions: request.questions,
      decisionModel: instantEvalOwnDecisionModelOf(resolved),
      ...(signal ? { signal } : {}),
    });
  }

  /** The hosted judge's availability governs every organization, own models included. */
  async isAvailableForOrganization(organizationId: string): Promise<boolean> {
    const { hosted } = this.options;
    return hosted.isAvailableForOrganization
      ? hosted.isAvailableForOrganization(organizationId)
      : true;
  }

  async close(): Promise<void> {
    await this.options.hosted.close?.();
  }

  /** Whether the project runs on its own key, which the $1 budget never binds (decision 7). */
  async isOwnDecisionModel({ projectId }: { projectId: string }): Promise<boolean> {
    return (
      (await this.options.decisionModels.resolveDecisionModel({ projectId })).kind !== "langwatch"
    );
  }
}
