import { SessionPolicyOutOfRangeError } from "@langwatch/enterprise-governance-contract";

import type { OrganizationSessionPolicyRepository } from "../repositories/session-policy.repository.ts";
import { type OrganizationSessionPolicy } from "../repositories/session-policy.repository.ts";

/**
 * The maximum lifetime an organization admin may enforce on CLI/device sessions. Zero means
 * unbounded; the hard cap of 365 keeps a silent typo of "9999" from making the field
 * effectively meaningless.
 */
export const SESSION_POLICY_MAX_DAYS = 365;

/** Read and update the organization's session-lifetime policy. */
export class OrganizationSessionPolicyService {
  private constructor(private readonly repository: OrganizationSessionPolicyRepository) {}

  static create(repository: OrganizationSessionPolicyRepository): OrganizationSessionPolicyService {
    return new OrganizationSessionPolicyService(repository);
  }

  async get(organizationId: string): Promise<OrganizationSessionPolicy> {
    return this.repository.find(organizationId);
  }

  async setMaxDurationDays(
    organizationId: string,
    maxSessionDurationDays: number,
  ): Promise<OrganizationSessionPolicy> {
    if (
      !Number.isInteger(maxSessionDurationDays) ||
      maxSessionDurationDays < 0 ||
      maxSessionDurationDays > SESSION_POLICY_MAX_DAYS
    ) {
      throw new SessionPolicyOutOfRangeError(maxSessionDurationDays, SESSION_POLICY_MAX_DAYS);
    }

    await this.repository.setMaxDurationDays(organizationId, maxSessionDurationDays);

    return { maxSessionDurationDays };
  }
}
