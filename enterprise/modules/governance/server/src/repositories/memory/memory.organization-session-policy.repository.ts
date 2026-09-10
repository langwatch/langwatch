// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import {
  OrganizationSessionPolicyPort,
  type OrganizationSessionPolicy,
} from "../policy/session-policy.repository.ts";

/** The unbounded default an organization carries until an admin sets a cap. */
const UNBOUNDED: OrganizationSessionPolicy = { maxSessionDurationDays: 0 };

/** The session policy twin: one column on one organization, held in a map. */
export class MemoryOrganizationSessionPolicyRepository extends OrganizationSessionPolicyPort {
  private readonly byOrganization = new Map<string, OrganizationSessionPolicy>();

  static create(): MemoryOrganizationSessionPolicyRepository {
    return new MemoryOrganizationSessionPolicyRepository();
  }

  async find(organizationId: string): Promise<OrganizationSessionPolicy> {
    return this.byOrganization.get(organizationId) ?? UNBOUNDED;
  }

  async setMaxDurationDays(
    organizationId: string,
    maxSessionDurationDays: number,
  ): Promise<void> {
    this.byOrganization.set(organizationId, { maxSessionDurationDays });
  }
}
