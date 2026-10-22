/**
 * The Instant Evals column: which decision model a project runs on, and whether an organization
 * may store one on its own key (ADR-182 decisions 4 and 5). The answer is kept a minute per
 * project, so a page of rows or a busy monitor asks the scope chain once.
 * @see specs/model-providers/instant-evals-decision-model.feature
 */

import { HandledError } from "@langwatch/handled-error";
import {
  findDecisionModel,
  INSTANT_EVAL_DECISION_FEATURE_KEY,
  isOwnDecisionModelId,
  ModelDefaultValidationError,
  type DecisionModelResolution,
  type ModelProvider,
} from "@langwatch/model-provider-contract";
import { nowInstant, type Instant } from "@langwatch/time";

import { decisionModelResolutionOf, picksOwnDecisionModel } from "../rules/decision-model.rules.ts";
import type { ModelProviderResolutionService } from "./model-provider-resolution.service.ts";
import type { ModelProviderScopeService } from "./model-provider-scope.service.ts";

/** Whether the organization has the own-decision-model flag, asked of the organization only. */
export type OwnDecisionModelGate = (input: { organizationId: string }) => Promise<boolean>;

type DecisionModelOptions = Readonly<{
  resolution: Pick<ModelProviderResolutionService, "resolve">;
  scopes: Pick<ModelProviderScopeService, "getProjectContext">;
  findProviderForProject: (input: {
    projectId: string;
    provider: string;
  }) => Promise<ModelProvider | null>;
  isOwnModelAllowed: OwnDecisionModelGate;
  now?: () => Instant;
}>;

const CACHE_TTL_MS = 60_000;
const MAX_CACHED_PROJECTS = 10_000;

type CachedResolution = Readonly<{
  resolution: Promise<DecisionModelResolution>;
  expiresAt: number;
}>;

/** The column holds nothing this catalogue still offers; it reads as LangWatch's default. */
const UNSET_CODES: ReadonlySet<string> = new Set([
  "model_not_configured",
  "model_restricted_for_feature",
]);

export class ModelProviderDecisionModelService {
  readonly #cache = new Map<string, CachedResolution>();

  private constructor(private readonly options: DecisionModelOptions) {}

  static create(options: DecisionModelOptions): ModelProviderDecisionModelService {
    return new ModelProviderDecisionModelService(options);
  }

  /** Concurrent callers share one lookup; a failed lookup is not kept. */
  resolve({ projectId }: { projectId: string }): Promise<DecisionModelResolution> {
    const nowMs = (this.options.now ?? nowInstant)().epochMilliseconds;
    const cached = this.#cache.get(projectId);
    if (cached && cached.expiresAt > nowMs) return cached.resolution;

    const resolution = this.lookUp(projectId);
    if (this.#cache.size >= MAX_CACHED_PROJECTS) this.#cache.clear();
    this.#cache.set(projectId, { resolution, expiresAt: nowMs + CACHE_TTL_MS });
    resolution.catch(() => {
      if (this.#cache.get(projectId)?.resolution === resolution) this.#cache.delete(projectId);
    });
    return resolution;
  }

  private async lookUp(projectId: string): Promise<DecisionModelResolution> {
    const model = await this.storedModel(projectId);
    if (model === undefined || !isOwnDecisionModelId(model)) return { kind: "langwatch" };

    const { organizationId } = await this.options.scopes.getProjectContext(projectId);
    const isOwnModelAllowed = await this.options.isOwnModelAllowed({ organizationId });
    if (!isOwnModelAllowed) return { kind: "own_unavailable", model, reason: "not_enabled" };

    const provider = findDecisionModel(model)?.provider ?? "";
    const row = await this.options.findProviderForProject({ projectId, provider });
    return decisionModelResolutionOf({ model, row: row ?? undefined });
  }

  /** Refuses a config that picks an own decision model for an organization without the flag. */
  async assertMayStore({
    organizationId,
    config,
    stored,
  }: {
    organizationId: string;
    config: Readonly<Record<string, string>>;
    stored?: Readonly<Record<string, string>>;
  }): Promise<void> {
    if (!picksOwnDecisionModel({ config, stored: stored ?? {} })) return;
    if (await this.options.isOwnModelAllowed({ organizationId })) return;

    throw new ModelDefaultValidationError(
      "Running Instant Evals on your own decision model is not enabled for this organization. Keep LangWatch Instant Preview, or ask LangWatch to enable it.",
    );
  }

  private async storedModel(projectId: string): Promise<string | undefined> {
    try {
      const resolved = await this.options.resolution.resolve({
        projectId,
        featureKey: INSTANT_EVAL_DECISION_FEATURE_KEY,
      });
      return resolved.model;
    } catch (error) {
      if (HandledError.isHandled(error) && UNSET_CODES.has(error.code)) return undefined;
      throw error;
    }
  }
}
