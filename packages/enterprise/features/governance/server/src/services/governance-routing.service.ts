import {
  RoutingPolicyModelMustBeConcreteError,
  RoutingPolicyMustHaveProviderError,
  RoutingPolicyMustHaveScopeError,
  RoutingPolicyNotFoundError,
  RoutingPolicyProviderScopeError,
  createRoutingPolicyInputSchema,
  deleteRoutingPolicyInputSchema,
  findRoutingPolicyInputSchema,
  listRoutingPoliciesInputSchema,
  resolveDefaultRoutingPolicyInputSchema,
  setDefaultRoutingPolicyInputSchema,
  updateRoutingPolicyInputSchema,
  type CreateRoutingPolicyInput,
  type DeleteRoutingPolicyInput,
  type FindRoutingPolicyInput,
  type ListRoutingPoliciesInput,
  type ResolveDefaultRoutingPolicyInput,
  type RoutingPolicy,
  type SetDefaultRoutingPolicyInput,
  type UpdateRoutingPolicyInput,
} from "@langwatch/enterprise-governance-contract";
import type { RoutingPolicyRepository } from "../ports/routing-policy.port";

const MOVING_MODEL_NAME = /^(openai|anthropic|gemini)\/(latest|latest-mini)$/;

export class DefaultGovernanceRoutingPolicyService {
  private constructor(private readonly repository: RoutingPolicyRepository) {
  }

  static create(options: {
    repository: RoutingPolicyRepository;
  }): DefaultGovernanceRoutingPolicyService {
    return new DefaultGovernanceRoutingPolicyService(options.repository);
  }

  list(input: ListRoutingPoliciesInput): Promise<RoutingPolicy[]> {
    return this.repository.list(listRoutingPoliciesInputSchema.parse(input));
  }

  async tryFindById(input: FindRoutingPolicyInput): Promise<RoutingPolicy | null> {
    const parsed = findRoutingPolicyInputSchema.parse(input);
    const policy = await this.repository.tryFindById(parsed.id);
    return policy?.organizationId === parsed.organizationId ? policy : null;
  }

  async getById(input: FindRoutingPolicyInput): Promise<RoutingPolicy> {
    const parsed = findRoutingPolicyInputSchema.parse(input);
    const policy = await this.tryFindById(parsed);
    if (!policy) throw new RoutingPolicyNotFoundError(parsed.id);
    return policy;
  }

  async create(input: CreateRoutingPolicyInput): Promise<RoutingPolicy> {
    if (input.scopes.length === 0) throw new RoutingPolicyMustHaveScopeError();
    if (input.modelProviderIds.length === 0) {
      throw new RoutingPolicyMustHaveProviderError();
    }
    const parsed = createRoutingPolicyInputSchema.parse(input);
    this.assertModelsAreConcrete(parsed);
    await this.assertProvidersReachable(parsed.organizationId, parsed.modelProviderIds);
    return this.repository.create(parsed);
  }

  async update(input: UpdateRoutingPolicyInput): Promise<RoutingPolicy> {
    if (input.modelProviderIds?.length === 0) {
      throw new RoutingPolicyMustHaveProviderError();
    }
    const parsed = updateRoutingPolicyInputSchema.parse(input);
    await this.getOwn(parsed.id, parsed.organizationId);
    this.assertModelsAreConcrete(parsed);
    if (parsed.modelProviderIds) {
      await this.assertProvidersReachable(parsed.organizationId, parsed.modelProviderIds);
    }
    return this.repository.update(parsed);
  }

  async setDefault(input: SetDefaultRoutingPolicyInput): Promise<RoutingPolicy> {
    const parsed = setDefaultRoutingPolicyInputSchema.parse(input);
    await this.getOwn(parsed.id, parsed.organizationId);
    return this.repository.setDefault(parsed);
  }

  async delete(input: DeleteRoutingPolicyInput): Promise<void> {
    const parsed = deleteRoutingPolicyInputSchema.parse(input);
    await this.getOwn(parsed.id, parsed.organizationId);
    return this.repository.delete(parsed);
  }

  tryResolveDefaultForUser(
    input: ResolveDefaultRoutingPolicyInput,
  ): Promise<RoutingPolicy | null> {
    return this.repository.tryResolveDefaultForUser(
      resolveDefaultRoutingPolicyInputSchema.parse(input),
    );
  }

  private async getOwn(id: string, organizationId: string): Promise<RoutingPolicy> {
    return this.getById({ id, organizationId });
  }

  private assertModelsAreConcrete(input: {
    defaultModel?: string | null;
    modelAliases?: Record<string, string>;
  }): void {
    const defaultModel = input.defaultModel?.trim();
    if (defaultModel && MOVING_MODEL_NAME.test(defaultModel)) {
      throw new RoutingPolicyModelMustBeConcreteError("defaultModel", defaultModel);
    }
    for (const [source, target] of Object.entries(input.modelAliases ?? {})) {
      const value = target.trim();
      if (MOVING_MODEL_NAME.test(value)) {
        throw new RoutingPolicyModelMustBeConcreteError(`modelAliases.${source}`, value);
      }
    }
  }

  private async assertProvidersReachable(
    organizationId: string,
    modelProviderIds: string[],
  ): Promise<void> {
    const reachable = await this.repository.countReachableModelProviders({
      organizationId,
      modelProviderIds,
    });
    if (reachable !== modelProviderIds.length) {
      throw new RoutingPolicyProviderScopeError();
    }
  }
}
