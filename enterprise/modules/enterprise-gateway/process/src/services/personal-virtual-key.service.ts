// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import {
  NoEligibleProvidersError,
  PersonalVirtualKeyAlreadyExistsError,
  PersonalVirtualKeyNotFoundError,
  RoutingPolicyHasNoProvidersError,
  ensureDefaultPersonalVirtualKeyInputSchema,
  issuePersonalVirtualKeyInputSchema,
  listPersonalVirtualKeysInputSchema,
  revokeAllPersonalVirtualKeysInputSchema,
  revokePersonalVirtualKeyInputSchema,
  type EnsureDefaultPersonalVirtualKeyInput,
  type IssuePersonalVirtualKeyInput,
  type IssuedPersonalVirtualKey,
  type ListPersonalVirtualKeysInput,
  type PersonalVirtualKey,
  type RevokeAllPersonalVirtualKeysInput,
  type RevokePersonalVirtualKeyInput,
} from "@langwatch/enterprise-gateway-contract";
import type { GatewayApi } from "@langwatch/gateway-contract";
import type { ModelProviderApi } from "@langwatch/model-provider-contract";
import type { OrganizationService } from "@langwatch/organization-contract";

import {
  DEFAULT_PERSONAL_KEY_LABEL,
  isDefaultPersonalKey,
  personalKeyEligibilityScopes,
  toPersonalVirtualKey,
} from "../rules/personal-virtual-key.rules.ts";
import type { PersonalVirtualKeyIssuerService } from "./personal-virtual-key-issuer.service.ts";

type PersonalKeyReads = Pick<GatewayApi, "findPersonalVirtualKeys" | "findVirtualKeyById">;
type PersonalVirtualKeyIssuer = Pick<PersonalVirtualKeyIssuerService, "issue" | "revoke">;
type ProviderCounts = Pick<ModelProviderApi, "countEnabledInScopes">;

type RoutingPolicyReader = {
  findById(input: { id: string; organizationId: string }): Promise<{
    id: string;
    name: string;
    organizationId: string;
    modelProviderIds: string[];
  } | null>;
  findDefaultForUser(input: { organizationId: string; personalTeamId: string }): Promise<{
    id: string;
    name: string;
    organizationId: string;
    modelProviderIds: string[];
  } | null>;
};

type RoutingPolicy = {
  id: string;
  name: string;
  organizationId: string;
  modelProviderIds: string[];
};

export class PersonalVirtualKeyService {
  private readonly keys: PersonalKeyReads;
  private readonly providers: ProviderCounts;
  private readonly issuer: PersonalVirtualKeyIssuer;
  private readonly organizations: Pick<OrganizationService, "ensurePersonalWorkspace">;
  private readonly policies: RoutingPolicyReader;
  private readonly gatewayBaseUrl: string;

  private constructor({
    keys,
    providers,
    issuer,
    organizations,
    policies,
    gatewayBaseUrl,
  }: {
    keys: PersonalKeyReads;
    providers: ProviderCounts;
    issuer: PersonalVirtualKeyIssuer;
    organizations: Pick<OrganizationService, "ensurePersonalWorkspace">;
    policies: RoutingPolicyReader;
    gatewayBaseUrl: string;
  }) {
    this.keys = keys;
    this.providers = providers;
    this.issuer = issuer;
    this.organizations = organizations;
    this.policies = policies;
    this.gatewayBaseUrl = gatewayBaseUrl;
  }

  static create(options: {
    keys: PersonalKeyReads;
    providers: ProviderCounts;
    issuer: PersonalVirtualKeyIssuer;
    organizations: Pick<OrganizationService, "ensurePersonalWorkspace">;
    policies: RoutingPolicyReader;
    gatewayBaseUrl: string;
  }): PersonalVirtualKeyService {
    return new PersonalVirtualKeyService({
      keys: options.keys,
      providers: options.providers,
      issuer: options.issuer,
      organizations: options.organizations,
      policies: options.policies,
      gatewayBaseUrl: options.gatewayBaseUrl,
    });
  }

  private resolvePolicy(parsed: IssuePersonalVirtualKeyInput): Promise<RoutingPolicy | null> {
    if (parsed.routingPolicyId) {
      return this.policies.findById({
        id: parsed.routingPolicyId,
        organizationId: parsed.organizationId,
      });
    }

    if (parsed.routingPolicyId === undefined && parsed.personalTeamId) {
      return this.policies.findDefaultForUser({
        organizationId: parsed.organizationId,
        personalTeamId: parsed.personalTeamId,
      });
    }

    return Promise.resolve(null);
  }

  async ensureDefault(
    input: EnsureDefaultPersonalVirtualKeyInput,
  ): Promise<IssuedPersonalVirtualKey> {
    const parsed = ensureDefaultPersonalVirtualKeyInputSchema.parse(input);
    const workspace = await this.organizations.ensurePersonalWorkspace(parsed);
    const held = await this.keys.findPersonalVirtualKeys({
      organizationId: parsed.organizationId,
      principalUserId: parsed.userId,
    });
    const existing = held.find((key) =>
      isDefaultPersonalKey({ key, personalProjectId: workspace.project.id }),
    );
    if (existing) {
      throw new PersonalVirtualKeyAlreadyExistsError(existing.id);
    }

    return this.issue({
      userId: parsed.userId,
      organizationId: parsed.organizationId,
      personalProjectId: workspace.project.id,
      personalTeamId: workspace.team.id,
      label: DEFAULT_PERSONAL_KEY_LABEL,
    });
  }

  async issue(input: IssuePersonalVirtualKeyInput): Promise<IssuedPersonalVirtualKey> {
    const parsed = issuePersonalVirtualKeyInputSchema.parse(input);
    const policy = await this.resolvePolicy(parsed);

    if (parsed.routingPolicyId && (!policy || policy.organizationId !== parsed.organizationId)) {
      throw new PersonalVirtualKeyNotFoundError(parsed.routingPolicyId);
    }

    const noPolicyRequested =
      parsed.routingPolicyId === undefined || parsed.routingPolicyId === null;
    const policyIsEmpty = Boolean(policy && policy.modelProviderIds.length === 0);
    if (noPolicyRequested && (!policy || policyIsEmpty)) {
      const eligible = await this.providers.countEnabledInScopes({
        scopes: personalKeyEligibilityScopes(parsed),
      });
      if (eligible === 0) {
        throw new NoEligibleProvidersError(parsed.organizationId);
      }
    } else if (policy && policyIsEmpty) {
      throw new RoutingPolicyHasNoProvidersError(policy.id, policy.name);
    }

    const resolvedPolicyId =
      noPolicyRequested && (!policy || policyIsEmpty) ? null : (policy?.id ?? null);
    const issued = await this.issuer.issue({
      organizationId: parsed.organizationId,
      userId: parsed.userId,
      personalProjectId: parsed.personalProjectId,
      label: parsed.label,
      routingPolicyId: resolvedPolicyId,
    });

    return {
      virtualKey: issued.virtualKey,
      secret: issued.secret,
      baseUrl: this.gatewayBaseUrl,
      routingPolicyId: resolvedPolicyId,
      id: issued.virtualKey.id,
      label: issued.virtualKey.name,
    };
  }

  async list(input: ListPersonalVirtualKeysInput): Promise<PersonalVirtualKey[]> {
    const parsed = listPersonalVirtualKeysInputSchema.parse(input);
    const keys = await this.keys.findPersonalVirtualKeys({
      organizationId: parsed.organizationId,
      ...(parsed.userId === undefined ? {} : { principalUserId: parsed.userId }),
    });
    return keys.map(toPersonalVirtualKey);
  }

  async revoke(input: RevokePersonalVirtualKeyInput): Promise<PersonalVirtualKey> {
    const parsed = revokePersonalVirtualKeyInputSchema.parse(input);
    const key = await this.keys.findVirtualKeyById(parsed.virtualKeyId, parsed.organizationId);
    if (!key || key.principalUserId !== parsed.userId) {
      throw new PersonalVirtualKeyNotFoundError(parsed.virtualKeyId);
    }

    return this.issuer.revoke({
      id: key.id,
      organizationId: key.organizationId,
      actorUserId: parsed.userId,
    });
  }

  /** Whether the person already holds a live key under this label here, as main refused. */
  async hasLiveKeyLabelled(input: {
    organizationId: string;
    userId: string;
    label: string;
  }): Promise<boolean> {
    const keys = await this.keys.findPersonalVirtualKeys({
      organizationId: input.organizationId,
      principalUserId: input.userId,
    });
    return keys.some((key) => key.name === input.label);
  }

  async revokeAllForUser(input: RevokeAllPersonalVirtualKeysInput): Promise<number> {
    const parsed = revokeAllPersonalVirtualKeysInputSchema.parse(input);
    const keys = await this.keys.findPersonalVirtualKeys({ principalUserId: parsed.userId });
    for (const key of keys) {
      await this.issuer.revoke({
        id: key.id,
        organizationId: key.organizationId,
        actorUserId: parsed.actorUserId,
      });
    }

    return keys.length;
  }
}
