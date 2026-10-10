// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type {
  CreateRoutingPolicyInput,
  DeleteRoutingPolicyInput,
  ListRoutingPoliciesInput,
  ResolveDefaultRoutingPolicyInput,
  RoutingPolicy,
  SetDefaultRoutingPolicyInput,
  UpdateRoutingPolicyInput,
} from "@langwatch/enterprise-gateway-contract";
import { generate } from "@langwatch/ksuid";
import { nowInstant } from "@langwatch/time";

import { RoutingPolicyRepository } from "../routing-policy.repository.ts";

const ROUTING_POLICY_KSUID_RESOURCE = "routepol";

/**
 * The routing-policy twin. One organization holds at most one default, so
 * setting a default clears the previous holder the way the Prisma
 * transaction does.
 */
export class MemoryRoutingPolicyRepository extends RoutingPolicyRepository {
  private constructor(private readonly policies: RoutingPolicy[]) {
    super();
  }

  static create(policies: RoutingPolicy[] = []): MemoryRoutingPolicyRepository {
    return new MemoryRoutingPolicyRepository(policies);
  }

  async findAll(input: ListRoutingPoliciesInput): Promise<RoutingPolicy[]> {
    return this.policies.filter((policy) => {
      if (policy.organizationId !== input.organizationId) return false;
      const scope = input.selectableForScope;
      if (!scope) return true;

      return policy.scopes.some(
        (entry) => entry.scopeType === scope.scopeType && entry.scopeId === scope.scopeId,
      );
    });
  }

  async count(input: { organizationId: string }): Promise<number> {
    return this.policies.filter((policy) => policy.organizationId === input.organizationId).length;
  }

  async findById(id: string): Promise<RoutingPolicy | null> {
    return this.policies.find((policy) => policy.id === id) ?? null;
  }

  async create(input: CreateRoutingPolicyInput): Promise<RoutingPolicy> {
    const now = nowInstant().epochMilliseconds;
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
    this.policies.push(policy);
    return policy;
  }

  async update(input: UpdateRoutingPolicyInput): Promise<RoutingPolicy> {
    const index = this.indexOfOwned(input);
    const current = this.policies[index]!;
    const updated: RoutingPolicy = {
      ...current,
      name: input.name ?? current.name,
      description: input.description === undefined ? current.description : input.description,
      modelProviderIds: input.modelProviderIds ?? current.modelProviderIds,
      modelAliases: input.modelAliases ?? current.modelAliases,
      defaultModel: input.defaultModel === undefined ? current.defaultModel : input.defaultModel,
      policyRules: input.policyRules ?? current.policyRules,
      updatedAtMs: nowInstant().epochMilliseconds,
      updatedById: input.actorUserId,
    };
    this.policies[index] = updated;
    return updated;
  }

  async setDefault(input: SetDefaultRoutingPolicyInput): Promise<RoutingPolicy> {
    const index = this.indexOfOwned(input);
    this.clearDefault(input.organizationId);
    const updated: RoutingPolicy = {
      ...this.policies[index]!,
      isDefault: true,
      updatedAtMs: nowInstant().epochMilliseconds,
      updatedById: input.actorUserId,
    };
    this.policies[index] = updated;
    return updated;
  }

  async delete(input: DeleteRoutingPolicyInput): Promise<void> {
    this.policies.splice(this.indexOfOwned(input), 1);
  }

  async findDefaultForUser(input: ResolveDefaultRoutingPolicyInput): Promise<RoutingPolicy | null> {
    return (
      this.policies.find(
        (policy) => policy.organizationId === input.organizationId && policy.isDefault,
      ) ?? null
    );
  }

  private indexOfOwned(input: { id: string; organizationId: string }): number {
    const index = this.policies.findIndex(
      (policy) => policy.id === input.id && policy.organizationId === input.organizationId,
    );
    if (index < 0) throw new Error(`No routing policy ${input.id}`);
    return index;
  }

  private clearDefault(organizationId: string): void {
    this.policies.forEach((policy, index) => {
      if (policy.organizationId !== organizationId || !policy.isDefault) return;
      this.policies[index] = { ...policy, isDefault: false };
    });
  }
}
