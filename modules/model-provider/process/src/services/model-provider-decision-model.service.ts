/**
 * The Instant Evals column: which decision model a project runs on, and whether an organization
 * may store one on its own key (ADR-182 decisions 4 and 5). Kept five seconds per project: a
 * page of rows asks once, and a saved model or key judges the next run.
 * @see specs/model-providers/instant-evals-decision-model.feature
 */

import { HandledError } from "@langwatch/handled-error";
import {
  DECISION_MODELS,
  findDecisionModel,
  INSTANT_EVAL_DECISION_FEATURE_KEY,
  isDecisionModelId,
  isOwnDecisionModelId,
  LANGWATCH_DECISION_MODEL_ID,
  ModelDefaultValidationError,
  ModelProviderInvalidError,
  type BuiltInModel,
  type DecisionModelEntry,
  type DecisionModelResolution,
  type ModelDefaultScope,
  type ModelProvider,
} from "@langwatch/model-provider-contract";
import { nowInstant, type Instant } from "@langwatch/time";

import {
  decisionModelResolutionOf,
  ownDecisionPicksToCheck,
  picksOwnDecisionModel,
} from "../rules/decision-model.rules.ts";
import type { ModelProviderResolutionService } from "./model-provider-resolution.service.ts";
import type { ModelProviderScopeService } from "./model-provider-scope.service.ts";

/** Whether the organization has the own-decision-model flag, asked of the organization only. */
export type OwnDecisionModelGate = (input: { organizationId: string }) => Promise<boolean>;

type RowLookup = (input: {
  scope: ModelDefaultScope;
  provider: string;
}) => Promise<ModelProvider | null>;

type DecisionModelOptions = Readonly<{
  resolution: Pick<ModelProviderResolutionService, "resolve">;
  scopes: Pick<ModelProviderScopeService, "getProjectContext" | "getOrganizationIdForScopes">;
  findProviderForProject: (input: {
    projectId: string;
    provider: string;
  }) => Promise<ModelProvider | null>;
  /** The row a Default models scope runs on, from that scope up only. */
  findProviderForScope: RowLookup;
  isOwnModelAllowed: OwnDecisionModelGate;
  now?: () => Instant;
}>;

const CACHE_TTL_MS = 5_000;
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

function choiceOf(entry: DecisionModelEntry): BuiltInModel {
  return { value: entry.id, label: entry.label };
}

export class ModelProviderDecisionModelService {
  readonly #cache = new Map<string, CachedResolution>();

  private constructor(private readonly options: DecisionModelOptions) {}

  static create(options: DecisionModelOptions): ModelProviderDecisionModelService {
    return new ModelProviderDecisionModelService(options);
  }

  /**
   * Concurrent callers share one lookup; a failed lookup is not kept. An override is part of
   * the key, so one judge's pick never answers for another's.
   */
  resolve({
    projectId,
    model,
  }: {
    projectId: string;
    model?: string;
  }): Promise<DecisionModelResolution> {
    const nowMs = (this.options.now ?? nowInstant)().epochMilliseconds;
    const key = model === undefined ? projectId : `${projectId}\u0000${model}`;
    const cached = this.#cache.get(key);
    if (cached && cached.expiresAt > nowMs) return cached.resolution;

    const resolution = this.lookUp({ projectId, override: model });
    if (this.#cache.size >= MAX_CACHED_PROJECTS) this.#cache.clear();
    this.#cache.set(key, { resolution, expiresAt: nowMs + CACHE_TTL_MS });
    resolution.catch(() => {
      if (this.#cache.get(key)?.resolution === resolution) this.#cache.delete(key);
    });
    return resolution;
  }

  /** The decision models this project may be offered: the hosted one, then any that would run. */
  async listPickable({ projectId }: { projectId: string }): Promise<readonly BuiltInModel[]> {
    const hosted = findDecisionModel(LANGWATCH_DECISION_MODEL_ID);
    const pickable: BuiltInModel[] = hosted ? [choiceOf(hosted)] : [];

    const { organizationId } = await this.options.scopes.getProjectContext(projectId);
    if (!(await this.options.isOwnModelAllowed({ organizationId }))) return pickable;

    const rows = new Map<string, ModelProvider | undefined>();
    for (const entry of DECISION_MODELS) {
      if (!isOwnDecisionModelId(entry.id)) continue;
      if (!rows.has(entry.provider)) {
        const row = await this.options.findProviderForProject({
          projectId,
          provider: entry.provider,
        });
        rows.set(entry.provider, row ?? undefined);
      }
      const resolution = decisionModelResolutionOf({
        model: entry.id,
        row: rows.get(entry.provider),
      });
      if (resolution.kind === "own") pickable.push(choiceOf(entry));
    }
    return pickable;
  }

  /**
   * A valid decision-model override wins over the stored column; anything else is ignored, so a
   * judge holding a chat model still reads the project default. The guards below are unchanged.
   */
  private async lookUp({
    projectId,
    override,
  }: {
    projectId: string;
    override: string | undefined;
  }): Promise<DecisionModelResolution> {
    const model =
      override !== undefined && isDecisionModelId(override)
        ? override
        : await this.storedModel(projectId);
    if (model === undefined || !isOwnDecisionModelId(model)) return { kind: "langwatch" };

    const { organizationId } = await this.options.scopes.getProjectContext(projectId);
    const isOwnModelAllowed = await this.options.isOwnModelAllowed({ organizationId });
    if (!isOwnModelAllowed) return { kind: "own_unavailable", model, reason: "not_enabled" };

    const provider = findDecisionModel(model)?.provider ?? "";
    const row = await this.options.findProviderForProject({ projectId, provider });
    return decisionModelResolutionOf({ model, row: row ?? undefined });
  }

  /** Decision models a config on these scopes may hold: own ones only if every scope runs them. */
  async listPickableForScopes({
    projectId,
    scopes,
  }: {
    projectId: string;
    scopes: readonly ModelDefaultScope[];
  }): Promise<readonly BuiltInModel[]> {
    const hosted = findDecisionModel(LANGWATCH_DECISION_MODEL_ID);
    const pickable: BuiltInModel[] = hosted ? [choiceOf(hosted)] : [];
    if (scopes.length === 0) return pickable;

    const { organizationId } = await this.options.scopes.getProjectContext(projectId);
    const scopesOrganizationId = await this.options.scopes.getOrganizationIdForScopes([...scopes]);
    if (scopesOrganizationId !== organizationId) {
      throw new ModelProviderInvalidError(
        "Default scope does not belong to the project organization",
      );
    }
    if (!(await this.options.isOwnModelAllowed({ organizationId }))) return pickable;

    const rowFor = this.rowLookup();
    for (const entry of DECISION_MODELS) {
      if (!isOwnDecisionModelId(entry.id)) continue;
      if (await this.runsFromEvery({ model: entry.id, scopes, rowFor })) {
        pickable.push(choiceOf(entry));
      }
    }
    return pickable;
  }

  /**
   * Refuses a config that picks an own decision model without the flag, or on a scope that has
   * no key it would run on. A value kept as it was is checked only on the scopes it gains.
   */
  async assertMayStore({
    organizationId,
    config,
    stored,
    scopes,
    storedScopes,
  }: {
    organizationId: string;
    config: Readonly<Record<string, string>>;
    stored?: Readonly<Record<string, string>>;
    scopes: readonly ModelDefaultScope[];
    storedScopes?: readonly ModelDefaultScope[];
  }): Promise<void> {
    const picks = ownDecisionPicksToCheck({ config, stored, scopes, storedScopes });
    if (picks.length === 0) return;

    const isOwnModelAllowed = await this.options.isOwnModelAllowed({ organizationId });
    if (!isOwnModelAllowed && picksOwnDecisionModel({ config, stored: stored ?? {} })) {
      throw new ModelDefaultValidationError(
        "Running Instant Evals on your own decision model is not enabled for this organization. Keep Evals Preview, or ask LangWatch to enable it.",
      );
    }
    if (!isOwnModelAllowed) return;

    const rowFor = this.rowLookup();
    for (const pick of picks) {
      if (await this.runsFromEvery({ model: pick.model, scopes: pick.scopes, rowFor })) continue;
      const label = findDecisionModel(pick.model)?.label ?? pick.model;
      throw new ModelDefaultValidationError(
        `${label} can't run for every scope of this config: at least one has no enabled key ` +
          "for it. Add the key at that scope or above, or keep Evals Preview.",
      );
    }
  }

  private async runsFromEvery({
    model,
    scopes,
    rowFor,
  }: {
    model: string;
    scopes: readonly ModelDefaultScope[];
    rowFor: RowLookup;
  }): Promise<boolean> {
    const provider = findDecisionModel(model)?.provider ?? "";
    for (const scope of scopes) {
      const row = await rowFor({ scope, provider });
      if (decisionModelResolutionOf({ model, row: row ?? undefined }).kind !== "own") return false;
    }
    return true;
  }

  /** Reads each provider row once per scope, however many of its models are checked. */
  private rowLookup(): RowLookup {
    const rows = new Map<string, Promise<ModelProvider | null>>();
    return ({ scope, provider }) => {
      const key = `${scope.scopeType}:${scope.scopeId}:${provider}`;
      const known = rows.get(key);
      if (known) return known;
      const row = this.options.findProviderForScope({ scope, provider });
      rows.set(key, row);
      return row;
    };
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
