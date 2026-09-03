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
} from "@langwatch/enterprise-governance-contract";
import type { OrganizationService } from "@langwatch/organization-contract";
import type {
  PersonalVirtualKeyIssuerPort,
  PersonalVirtualKeyRepository,
} from "../ports/personal-virtual-key.port";

const DEFAULT_PERSONAL_KEY_LABEL = "default";

type RoutingPolicyReader = {
  tryFindById(input: {
    id: string;
    organizationId: string;
  }): Promise<{
    id: string;
    name: string;
    organizationId: string;
    modelProviderIds: string[];
  } | null>;
  tryResolveDefaultForUser(input: {
    organizationId: string;
    personalTeamId: string;
  }): Promise<{
    id: string;
    name: string;
    organizationId: string;
    modelProviderIds: string[];
  } | null>;
};

export class DefaultGovernancePersonalVirtualKeyService {
  private constructor(
    private readonly repository: PersonalVirtualKeyRepository,
    private readonly issuer: PersonalVirtualKeyIssuerPort,
    private readonly organizations: OrganizationService,
    private readonly policies: RoutingPolicyReader,
    private readonly gatewayBaseUrl: string,
  ) {}

  static create(options: {
    repository: PersonalVirtualKeyRepository;
    issuer: PersonalVirtualKeyIssuerPort;
    organizations: OrganizationService;
    policies: RoutingPolicyReader;
    gatewayBaseUrl: string;
  }): DefaultGovernancePersonalVirtualKeyService {
    return new DefaultGovernancePersonalVirtualKeyService(
      options.repository,
      options.issuer,
      options.organizations,
      options.policies,
      options.gatewayBaseUrl,
    );
  }

  async ensureDefault(
    input: EnsureDefaultPersonalVirtualKeyInput,
  ): Promise<IssuedPersonalVirtualKey> {
    const parsed = ensureDefaultPersonalVirtualKeyInputSchema.parse(input);
    const workspace = await this.organizations.ensurePersonalWorkspace(parsed);
    const existing = await this.repository.tryFindDefault({
      userId: parsed.userId,
      organizationId: parsed.organizationId,
      personalProjectId: workspace.project.id,
    });
    if (existing) throw new PersonalVirtualKeyAlreadyExistsError(existing.id);
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
    let policy = null;
    if (parsed.routingPolicyId) {
      policy = await this.policies.tryFindById({
        id: parsed.routingPolicyId,
        organizationId: parsed.organizationId,
      });
    } else if (parsed.routingPolicyId === undefined && parsed.personalTeamId) {
      policy = await this.policies.tryResolveDefaultForUser({
        organizationId: parsed.organizationId,
        personalTeamId: parsed.personalTeamId,
      });
    }
    if (parsed.routingPolicyId && (!policy || policy.organizationId !== parsed.organizationId)) {
      throw new PersonalVirtualKeyNotFoundError(parsed.routingPolicyId);
    }

    const noPolicyRequested =
      parsed.routingPolicyId === undefined || parsed.routingPolicyId === null;
    const policyIsEmpty = Boolean(policy && policy.modelProviderIds.length === 0);
    if (noPolicyRequested && (!policy || policyIsEmpty)) {
      const eligible = await this.repository.countEligibleProviders({
        organizationId: parsed.organizationId,
        personalTeamId: parsed.personalTeamId,
        personalProjectId: parsed.personalProjectId,
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

  list(input: ListPersonalVirtualKeysInput): Promise<PersonalVirtualKey[]> {
    return this.repository.list(listPersonalVirtualKeysInputSchema.parse(input));
  }

  async revoke(input: RevokePersonalVirtualKeyInput): Promise<PersonalVirtualKey> {
    const parsed = revokePersonalVirtualKeyInputSchema.parse(input);
    const key = await this.repository.tryFindOwned({
      id: parsed.virtualKeyId,
      organizationId: parsed.organizationId,
      userId: parsed.userId,
    });
    if (!key) throw new PersonalVirtualKeyNotFoundError(parsed.virtualKeyId);
    return this.issuer.revoke({
      id: key.id,
      organizationId: key.organizationId,
      actorUserId: parsed.userId,
    });
  }

  async revokeAllForUser(input: RevokeAllPersonalVirtualKeysInput): Promise<number> {
    const parsed = revokeAllPersonalVirtualKeysInputSchema.parse(input);
    const keys = await this.repository.listActiveForUser(parsed.userId);
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
