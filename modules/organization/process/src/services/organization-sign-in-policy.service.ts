import type {
  OrganizationJoinSetting,
  SignInSecurityPolicy,
} from "@langwatch/organization-contract";

import type { OrganizationRepository } from "../repositories/organization.repository.ts";

/** How people get into an organization: domain joins, SSO domain, session and sign-in policy. */
export class OrganizationSignInPolicyService {
  private constructor(private readonly repository: OrganizationRepository) {}

  static create({
    repository,
  }: {
    repository: OrganizationRepository;
  }): OrganizationSignInPolicyService {
    return new OrganizationSignInPolicyService(repository);
  }

  /** How colleagues on a matching domain get in, where the organization keeps it. */
  getJoinSetting(input: { organizationId: string }): Promise<OrganizationJoinSetting> {
    return this.repository.getJoinSetting(input);
  }

  saveJoinSetting(input: {
    organizationId: string;
    setting: OrganizationJoinSetting;
  }): Promise<void> {
    return this.repository.saveJoinSetting(input);
  }

  findBySsoDomain(input: {
    domain: string;
  }): Promise<{ id: string; name: string; ssoProvider: string | null } | null> {
    return this.repository.findBySsoDomain(input);
  }

  getSessionPolicy(input: { organizationId: string }): Promise<{ maxSessionDurationDays: number }> {
    return this.repository.getSessionPolicy(input);
  }

  saveSessionPolicy(input: {
    organizationId: string;
    maxSessionDurationDays: number;
  }): Promise<void> {
    return this.repository.saveSessionPolicy(input);
  }

  getSignInSecurityPolicy(input: { organizationId: string }): Promise<SignInSecurityPolicy> {
    return this.repository.getSignInSecurityPolicy(input);
  }

  updateSignInSecurityPolicy(input: {
    organizationId: string;
    policy: SignInSecurityPolicy;
  }): Promise<void> {
    return this.repository.updateSignInSecurityPolicy(input);
  }

  findSignInSecurityPoliciesForUser(input: { userId: string }): Promise<SignInSecurityPolicy[]> {
    return this.repository.findSignInSecurityPoliciesForUser(input);
  }

  findConfiguredSignInSecurityPolicies(): Promise<SignInSecurityPolicy[]> {
    return this.repository.findConfiguredSignInSecurityPolicies();
  }
}
