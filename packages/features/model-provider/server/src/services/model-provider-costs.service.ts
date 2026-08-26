import {
  estimateModelCost,
  ModelCostNotFoundError,
  ModelProviderInvalidError,
  modelCostDeleteInputSchema,
  modelCostListInputSchema,
  modelCostWriteInputSchema,
  type ModelCost,
  type ModelCostDeleteInput,
  type ModelCostEstimateInput,
  type ModelCostWriteInput,
} from "@langwatch/model-provider-contract";
import type {
  ModelCostRepository,
  ModelProviderCatalog,
  ModelProviderIdService,
} from "../ports/model-provider.port";
import { ModelProviderAuthorizationService } from "./model-provider-authorization.service";
import type { ModelProviderScopeService } from "./model-provider-scope.service";

type ModelProviderCostsOptions = {
  costs: ModelCostRepository;
  catalog: ModelProviderCatalog;
  authorization: ModelProviderAuthorizationService;
  ids: ModelProviderIdService;
  scopes: ModelProviderScopeService;
};

export class ModelProviderCostsService {
  private constructor(private readonly options: ModelProviderCostsOptions) {}

  static create(options: ModelProviderCostsOptions): ModelProviderCostsService {
    return new ModelProviderCostsService(options);
  }

  estimate(input: ModelCostEstimateInput): number {
    return estimateModelCost(input, this.options.catalog.staticCostRates());
  }

  async list(input: { projectId: string }): Promise<ModelCost[]> {
    const projectId = modelCostListInputSchema.parse(input).projectId;
    const projectScopes = await this.options.scopes.tryGetProjectScopes(projectId);
    return projectScopes ? this.options.costs.listForProject(projectScopes) : [];
  }

  async upsert(input: ModelCostWriteInput): Promise<ModelCost> {
    const parsed = modelCostWriteInputSchema.parse(input);
    const existing = parsed.id ? await this.options.costs.tryFindById(parsed.id) : null;
    if (parsed.id && !existing) {
      throw new ModelCostNotFoundError();
    }

    const targetScope = {
      scopeType: parsed.scopeType ?? "PROJECT",
      scopeId: parsed.scopeId ?? parsed.projectId,
    } as const;
    const organizationId =
      await this.options.scopes.getOrganizationIdForScope(targetScope);
    if (existing && existing.organizationId !== organizationId) {
      throw new ModelProviderInvalidError("Cost cannot move between organizations");
    }

    await this.assertWritable({
      actorId: parsed.actorId,
      currentScope: existing
        ? { scopeType: existing.scopeType, scopeId: existing.scopeId }
        : null,
      targetScope,
    });

    const now = new Date();
    return this.options.costs.save({
      id: existing?.id ?? parsed.id ?? this.options.ids.generate({ type: "cost" }),
      organizationId,
      scopeType: parsed.scopeType ?? existing?.scopeType ?? "PROJECT",
      scopeId: parsed.scopeId ?? existing?.scopeId ?? parsed.projectId,
      model: parsed.model,
      regex: parsed.regex,
      inputCostPerToken: parsed.inputCostPerToken ?? null,
      outputCostPerToken: parsed.outputCostPerToken ?? null,
      cacheReadCostPerToken: parsed.cacheReadCostPerToken ?? null,
      cacheCreationCostPerToken: parsed.cacheCreationCostPerToken ?? null,
      cacheCreation1hCostPerToken: parsed.cacheCreation1hCostPerToken ?? null,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
  }

  async delete(input: ModelCostDeleteInput): Promise<void> {
    const parsed = modelCostDeleteInputSchema.parse(input);
    const existing = await this.options.costs.tryFindById(parsed.id);
    if (!existing) {
      throw new ModelCostNotFoundError();
    }

    const organizationId = await this.options.scopes.tryResolveAnchor({
      projectId: parsed.projectId,
    });
    if (!organizationId || organizationId !== existing.organizationId) {
      throw new ModelCostNotFoundError();
    }
    await this.assertWritable({
      actorId: parsed.actorId,
      currentScope: { scopeType: existing.scopeType, scopeId: existing.scopeId },
      targetScope: null,
    });

    await this.options.costs.delete(parsed.id);
  }

  private async assertWritable(input: {
    actorId: string | undefined;
    currentScope: {
      scopeType: "ORGANIZATION" | "TEAM" | "PROJECT";
      scopeId: string;
    } | null;
    targetScope: {
      scopeType: "ORGANIZATION" | "TEAM" | "PROJECT";
      scopeId: string;
    } | null;
  }): Promise<void> {
    if (!input.actorId) {
      return;
    }

    if (input.currentScope) {
      const canWriteCurrent = await this.options.authorization.canWrite(
        input.actorId,
        input.currentScope,
      );
      if (!canWriteCurrent) {
        throw new ModelProviderInvalidError("Cannot manage the current cost scope");
      }
    }
    if (input.targetScope) {
      const canWriteTarget = await this.options.authorization.canWrite(
        input.actorId,
        input.targetScope,
      );
      if (!canWriteTarget) {
        throw new ModelProviderInvalidError("Cannot manage cost scope");
      }
    }
  }
}
