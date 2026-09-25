// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { AuthzApi } from "@langwatch/authz-contract";
import {
  type CreateRoutingPolicyInput,
  type DeleteRoutingPolicyInput,
  EnterpriseGatewayApi,
  type EnterpriseGatewayApi as EnterpriseGatewayApiContract,
  type EnterpriseGatewayConfig,
  enterpriseGatewayBaseUrl,
  enterpriseGatewayConfig,
  type EnsureDefaultPersonalVirtualKeyInput,
  type FindRoutingPolicyInput,
  type IssuedPersonalVirtualKey,
  type IssuedPersonalVirtualKeyAnswer,
  type IssuePersonalVirtualKeyInput,
  type ListPersonalVirtualKeysInput,
  type ListRoutingPoliciesInput,
  type PersonalVirtualKey,
  type RoutingPolicy,
  RoutingPolicyModelMustBeConcreteError,
  RoutingPolicyModelNotConcreteError,
  RoutingPolicyMustHaveProviderError,
  RoutingPolicyMustHaveScopeError,
  RoutingPolicyProviderRequiredError,
  RoutingPolicyScopeRequiredError,
  type SetDefaultRoutingPolicyInput,
  type UpdateRoutingPolicyInput,
} from "@langwatch/enterprise-gateway-contract";
import { GatewayApi } from "@langwatch/gateway-contract";
import type { FeatureSetup } from "@langwatch/kernel";
import {
  ModelProviderApi,
  suggestTierTargets,
  type SuggestTierTargetsInput,
  type TierTargetSuggestion,
} from "@langwatch/model-provider-contract";
import { OrganizationApi } from "@langwatch/organization-contract";
import { ProjectApi } from "@langwatch/project-contract";

import type { EnterpriseGatewayRepositories } from "../repositories/routing-policy.repository.ts";
import { PersonalVirtualKeyAccessService } from "../services/personal-virtual-key-access.service.ts";
import { PersonalVirtualKeyIssuerService } from "../services/personal-virtual-key-issuer.service.ts";
import { PersonalVirtualKeyService } from "../services/personal-virtual-key.service.ts";
import { RoutingPolicyService } from "../services/routing-policy.service.ts";

type EnterpriseGatewaySetup = FeatureSetup<
  typeof EnterpriseGatewayApp.dependencies,
  Readonly<{ isSaas: boolean }>,
  EnterpriseGatewayConfig | undefined,
  EnterpriseGatewayRepositories
>;

/** Routing policies and personal keys, over the gateway's own virtual keys through `GatewayApi`. */
export class EnterpriseGatewayApp implements EnterpriseGatewayApiContract {
  static readonly contract = EnterpriseGatewayApi;
  static readonly config = enterpriseGatewayConfig;
  static readonly reads = ["isSaas"] as const;
  static readonly dependencies = {
    gateway: GatewayApi,
    projects: ProjectApi,
    organizations: OrganizationApi,
    authz: AuthzApi,
    modelProviders: ModelProviderApi,
  };

  readonly #policies: RoutingPolicyService;
  readonly #personalKeys: PersonalVirtualKeyService;
  readonly #personalKeyDoors: PersonalVirtualKeyAccessService;

  private constructor(parts: {
    policies: RoutingPolicyService;
    personalKeys: PersonalVirtualKeyService;
    personalKeyDoors: PersonalVirtualKeyAccessService;
  }) {
    this.#policies = parts.policies;
    this.#personalKeys = parts.personalKeys;
    this.#personalKeyDoors = parts.personalKeyDoors;
  }

  static create({
    dependencies,
    config,
    members,
    repositories,
  }: EnterpriseGatewaySetup): EnterpriseGatewayApp {
    const policies = RoutingPolicyService.create({
      repository: repositories.routingPolicies,
      providers: dependencies.modelProviders,
      projects: dependencies.projects,
    });
    const personalKeys = PersonalVirtualKeyService.create({
      keys: dependencies.gateway,
      providers: dependencies.modelProviders,
      issuer: PersonalVirtualKeyIssuerService.create(dependencies.gateway),
      organizations: dependencies.organizations,
      policies,
      gatewayBaseUrl: enterpriseGatewayBaseUrl({ config, isSaas: members.isSaas }),
    });
    return new EnterpriseGatewayApp({
      policies,
      personalKeys,
      personalKeyDoors: PersonalVirtualKeyAccessService.create({
        keys: personalKeys,
        members: dependencies.organizations,
        permissions: dependencies.authz,
      }),
    });
  }

  listRoutingPolicies(input: ListRoutingPoliciesInput): Promise<RoutingPolicy[]> {
    return this.#policies.list(input);
  }

  getRoutingPolicy(input: FindRoutingPolicyInput): Promise<RoutingPolicy> {
    return this.#policies.getById(input);
  }

  countRoutingPolicies(input: { organizationId: string }): Promise<number> {
    return this.#policies.count(input);
  }

  routingPolicyTierSuggestions(
    input: Omit<SuggestTierTargetsInput, "limit">,
  ): TierTargetSuggestion[] {
    return suggestTierTargets({ tier: input.tier, boundProviderTypes: input.boundProviderTypes });
  }

  async createRoutingPolicy(input: CreateRoutingPolicyInput): Promise<RoutingPolicy> {
    try {
      return await this.#policies.create(input);
    } catch (error) {
      throw asHandledRoutingPolicyError(error);
    }
  }

  async updateRoutingPolicy(input: UpdateRoutingPolicyInput): Promise<RoutingPolicy> {
    try {
      return await this.#policies.update(input);
    } catch (error) {
      throw asHandledRoutingPolicyError(error);
    }
  }

  setDefaultRoutingPolicy(input: SetDefaultRoutingPolicyInput): Promise<RoutingPolicy> {
    return this.#policies.setDefault(input);
  }

  deleteRoutingPolicy(input: DeleteRoutingPolicyInput): Promise<void> {
    return this.#policies.delete(input);
  }

  listPersonalVirtualKeys(
    input: Readonly<{ organizationId: string; targetUserId?: string; actorUserId: string }>,
  ): Promise<PersonalVirtualKey[]> {
    return this.#personalKeyDoors.list(input);
  }

  issuePersonalVirtualKey(
    input: Readonly<{
      organizationId: string;
      label: string;
      routingPolicyId?: string;
      actorUserId: string;
    }>,
  ): Promise<IssuedPersonalVirtualKeyAnswer> {
    return this.#personalKeyDoors.issue(input);
  }

  revokePersonalVirtualKey(
    input: Readonly<{ organizationId: string; id: string; actorUserId: string }>,
  ): Promise<void> {
    return this.#personalKeyDoors.revoke(input);
  }

  personalVirtualKeyList(input: ListPersonalVirtualKeysInput): Promise<PersonalVirtualKey[]> {
    return this.#personalKeys.list(input);
  }

  personalVirtualKeyEnsureDefault(
    input: EnsureDefaultPersonalVirtualKeyInput,
  ): Promise<IssuedPersonalVirtualKey> {
    return this.#personalKeys.ensureDefault(input);
  }

  personalVirtualKeyIssue(input: IssuePersonalVirtualKeyInput): Promise<IssuedPersonalVirtualKey> {
    return this.#personalKeys.issue(input);
  }
}

/** The three routing-policy guards as handled errors; anything else stays unknown (ADR-045). */
function asHandledRoutingPolicyError(error: unknown): unknown {
  if (error instanceof RoutingPolicyMustHaveProviderError) {
    return new RoutingPolicyProviderRequiredError();
  }
  if (error instanceof RoutingPolicyMustHaveScopeError) {
    return new RoutingPolicyScopeRequiredError();
  }
  if (error instanceof RoutingPolicyModelMustBeConcreteError) {
    return new RoutingPolicyModelNotConcreteError(error.field, error.value);
  }
  return error;
}
