// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type {
  CreateRoutingPolicyInput,
  DeleteRoutingPolicyInput,
  ListRoutingPoliciesInput,
  ResolveDefaultRoutingPolicyInput,
  RoutingPolicy,
  SetDefaultRoutingPolicyInput,
  UpdateRoutingPolicyInput,
} from "@langwatch/enterprise-governance-contract";
import { generate } from "@langwatch/ksuid";
import { RoutingPolicyRepository } from "../policy/routing-policy.repository.ts";
import type { MemoryGovernanceStore } from "./memory-governance.store.ts";

const ROUTING_POLICY_KSUID_RESOURCE = "routepol";

/**
 * The routing-policy twin. One organization holds at most one default, so
 * setting a default clears the previous holder the way the Prisma
 * transaction does.
 */
export class MemoryRoutingPolicyRepository extends RoutingPolicyRepository {
  private constructor(private readonly store: MemoryGovernanceStore) {
    super();
  }

  static create(store: MemoryGovernanceStore): MemoryRoutingPolicyRepository {
    return new MemoryRoutingPolicyRepository(store);
  }

  async list(input: ListRoutingPoliciesInput): Promise<RoutingPolicy[]> {
    return this.store.routingPolicies.filter((policy) => {
      if (policy.organizationId !== input.organizationId) return false;
      const scope = input.selectableForScope;
      if (!scope) return true;

      return policy.scopes.some(
        (entry) => entry.scopeType === scope.scopeType && entry.scopeId === scope.scopeId,
      );
    });
  }

  async findById(id: string): Promise<RoutingPolicy | null> {
    return this.store.routingPolicies.find((policy) => policy.id === id) ?? null;
  }

  async countReachableModelProviders(input: {
    organizationId: string;
    modelProviderIds: string[];
  }): Promise<number> {
    const reachable = this.store.eligibleProviderIds.get(input.organizationId) ?? [];
    return input.modelProviderIds.filter((id) => reachable.includes(id)).length;
  }

  async create(input: CreateRoutingPolicyInput): Promise<RoutingPolicy> {
    const now = Date.now();
    const policy: RoutingPolicy = {
      id: generate(ROUTING_POLICY_KSUID_RESOURCE).toString(),
      organizationId: input.organizationId,
      name: input.name,
      description: input.description ?? null,
      modelProviderIds: [...input.modelProviderIds],
      modelAliases: input.modelAliases ?? {},
      defaultModel: input.defaultModel ?? null,
      policyRules: input.policyRules ?? {},
      isDefault: input.isDefault ?? false,
      createdAtMs: now,
      updatedAtMs: now,
      createdById: input.actorUserId,
      updatedById: input.actorUserId,
      scopes: [...input.scopes],
    };
    if (policy.isDefault) this.clearDefault(policy.organizationId);
    this.store.routingPolicies.push(policy);
    return policy;
  }

  async update(input: UpdateRoutingPolicyInput): Promise<RoutingPolicy> {
    const index = this.indexOfOwned(input);
    const current = this.store.routingPolicies[index]!;
    const updated: RoutingPolicy = {
      ...current,
      name: input.name ?? current.name,
      description: input.description === undefined ? current.description : input.description,
      modelProviderIds: input.modelProviderIds ?? current.modelProviderIds,
      modelAliases: input.modelAliases ?? current.modelAliases,
      defaultModel: input.defaultModel === undefined ? current.defaultModel : input.defaultModel,
      policyRules: input.policyRules ?? current.policyRules,
      updatedAtMs: Date.now(),
      updatedById: input.actorUserId,
    };
    this.store.routingPolicies[index] = updated;
    return updated;
  }

  async setDefault(input: SetDefaultRoutingPolicyInput): Promise<RoutingPolicy> {
    const index = this.indexOfOwned(input);
    this.clearDefault(input.organizationId);
    const updated: RoutingPolicy = {
      ...this.store.routingPolicies[index]!,
      isDefault: true,
      updatedAtMs: Date.now(),
      updatedById: input.actorUserId,
    };
    this.store.routingPolicies[index] = updated;
    return updated;
  }

  async delete(input: DeleteRoutingPolicyInput): Promise<void> {
    this.store.routingPolicies.splice(this.indexOfOwned(input), 1);
  }

  async findDefaultForUser(
    input: ResolveDefaultRoutingPolicyInput,
  ): Promise<RoutingPolicy | null> {
    return (
      this.store.routingPolicies.find(
        (policy) => policy.organizationId === input.organizationId && policy.isDefault,
      ) ?? null
    );
  }

  private indexOfOwned(input: { id: string; organizationId: string }): number {
    const index = this.store.routingPolicies.findIndex(
      (policy) => policy.id === input.id && policy.organizationId === input.organizationId,
    );
    if (index < 0) throw new Error(`No routing policy ${input.id}`);
    return index;
  }

  private clearDefault(organizationId: string): void {
    this.store.routingPolicies.forEach((policy, index) => {
      if (policy.organizationId !== organizationId || !policy.isDefault) return;
      this.store.routingPolicies[index] = { ...policy, isDefault: false };
    });
  }
}
