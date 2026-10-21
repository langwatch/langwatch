/**
 * Sends a project on its own decision model to the judge leaf with its key, and every other
 * project to the deployment's judge as before (ADR-182 decisions 6, 7 and 9). The project's
 * column is read once a minute, so a page of rows asks model provider once.
 * @see specs/model-providers/instant-evals-decision-model.feature
 */

import {
  instantEvalSkipped,
  type InstantEvalJudgeApi,
  type InstantEvalJudgement,
} from "@langwatch/instant-eval-judge-contract";
import type { DecisionModelResolution, ModelProviderApi } from "@langwatch/model-provider-contract";
import { nowInstant, type Instant } from "@langwatch/time";

import type {
  InstantEvalClassifyRequest,
  InstantEvalJudgeChannel,
} from "../channels/instant-eval-judging.channel.ts";

const CACHE_TTL_MS = 60_000;
const MAX_CACHED_PROJECTS = 10_000;

type CachedResolution = Readonly<{ resolution: DecisionModelResolution; expiresAt: number }>;

export class InstantEvalDecisionModelJudgeService implements InstantEvalJudgeChannel {
  readonly #cache = new Map<string, CachedResolution>();

  private constructor(
    private readonly options: Readonly<{
      hosted: InstantEvalJudgeChannel;
      own: Pick<InstantEvalJudgeApi, "classify">;
      decisionModels: Pick<ModelProviderApi, "resolveDecisionModel">;
      now: () => Instant;
    }>,
  ) {}

  static create({
    hosted,
    own,
    decisionModels,
    now = nowInstant,
  }: {
    hosted: InstantEvalJudgeChannel;
    own: Pick<InstantEvalJudgeApi, "classify">;
    decisionModels: Pick<ModelProviderApi, "resolveDecisionModel">;
    now?: () => Instant;
  }): InstantEvalDecisionModelJudgeService {
    return new InstantEvalDecisionModelJudgeService({ hosted, own, decisionModels, now });
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
    const resolved = await this.resolve({ projectId: request.projectId });
    if (resolved.kind === "langwatch") return this.options.hosted.classify(request, signal);
    if (resolved.kind === "own_unavailable") {
      // Never LangWatch's classifier in its place (ADR-182 decision 9).
      return instantEvalSkipped(
        resolved.reason === "not_enabled" ? "classifier_not_configured" : "classifier_key_invalid",
      );
    }

    const { model, wire, providerModel, endpoint, apiKey } = resolved;
    return this.options.own.classify({
      projectId: request.projectId,
      text: request.text,
      questions: request.questions,
      decisionModel: { model, wire, providerModel, endpoint, apiKey },
      ...(signal ? { signal } : {}),
    });
  }

  /** An organization on its own model judges wherever its key works; the rest ask the judge. */
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
    return (await this.resolve({ projectId })).kind !== "langwatch";
  }

  private async resolve({ projectId }: { projectId: string }): Promise<DecisionModelResolution> {
    const nowMs = this.options.now().epochMilliseconds;
    const cached = this.#cache.get(projectId);
    if (cached && cached.expiresAt > nowMs) return cached.resolution;

    const resolution = await this.options.decisionModels.resolveDecisionModel({ projectId });
    if (this.#cache.size >= MAX_CACHED_PROJECTS) this.#cache.clear();
    this.#cache.set(projectId, { resolution, expiresAt: nowMs + CACHE_TTL_MS });
    return resolution;
  }
}
