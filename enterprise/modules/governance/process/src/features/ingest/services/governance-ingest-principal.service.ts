// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { OrganizationApi } from "@langwatch/organization-contract";

import type { GovernanceIngestPrincipalDirectory } from "./governance-ingest-receiver.service.ts";

/**
 * Who a cost event's email names, inside the source's organization only: main's
 * `user.findFirst({ email, orgMemberships: { some: { organizationId } } })`, which matched any
 * membership row, disabled and deactivated included.
 */
export class GovernanceIngestPrincipalService implements GovernanceIngestPrincipalDirectory {
  private constructor(
    private readonly organizations: Pick<OrganizationApi, "findMembersIncludingDeactivated">,
  ) {}

  static create(input: {
    organizations: Pick<OrganizationApi, "findMembersIncludingDeactivated">;
  }): GovernanceIngestPrincipalService {
    return new GovernanceIngestPrincipalService(input.organizations);
  }

  async findMemberIdByEmail(input: {
    email: string;
    organizationId: string;
  }): Promise<string | null> {
    const members = await this.organizations.findMembersIncludingDeactivated({
      organizationId: input.organizationId,
    });
    return members.find((member) => member.email === input.email)?.id ?? null;
  }
}
