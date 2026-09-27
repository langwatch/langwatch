// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { OrganizationApi } from "@langwatch/organization-contract";
import type { UserApi } from "@langwatch/user-contract";

import type { GovernanceIngestPrincipalDirectory } from "./governance-ingest-receiver.service.ts";

/**
 * Who a cost event's email names, inside the source's organization only: main's
 * `user.findFirst({ email, orgMemberships: { some: { organizationId } } })`, over the peers.
 */
export class GovernanceIngestPrincipalService implements GovernanceIngestPrincipalDirectory {
  private constructor(
    private readonly users: Pick<UserApi, "findByEmail">,
    private readonly organizations: Pick<OrganizationApi, "isMember">,
  ) {}

  static create(input: {
    users: Pick<UserApi, "findByEmail">;
    organizations: Pick<OrganizationApi, "isMember">;
  }): GovernanceIngestPrincipalService {
    return new GovernanceIngestPrincipalService(input.users, input.organizations);
  }

  async findMemberIdByEmail(input: {
    email: string;
    organizationId: string;
  }): Promise<string | null> {
    const user = await this.users.findByEmail({ email: input.email });
    if (!user) return null;
    const member = await this.organizations.isMember({
      organizationId: input.organizationId,
      userId: user.id,
    });
    return member ? user.id : null;
  }
}
