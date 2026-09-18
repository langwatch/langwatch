// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The CLI's "contact your admin" address, resolved as the first enabled
 * admin membership's email. `OrganizationApi` has no purpose-built lookup for
 * this, so this service reads the general member listing and filters —
 * capped at a generous page so an admin outside the first page is not missed
 * in the common case; see `.claude/handoffs/gov-peer-ports.md` for the
 * pagination risk on very large organizations.
 */
import type { OrganizationApi } from "@langwatch/organization-contract";
import type { CliAdminContactReader } from "../app/governance.members.ts";

/** The one organization operation this service needs, out of `OrganizationApi`'s whole surface. */
type CliAdminContactOrganizations = Pick<OrganizationApi, "listMembers">;

export class OrganizationCliAdminContactService implements CliAdminContactReader {
  private constructor(private readonly organizations: CliAdminContactOrganizations) {}

  static create(organizations: CliAdminContactOrganizations): OrganizationCliAdminContactService {
    return new OrganizationCliAdminContactService(organizations);
  }

  async findAdminEmail(organizationId: string): Promise<string | null> {
    const { members } = await this.organizations.listMembers({
      organizationId,
      limit: 500,
    });
    const admin = members.find((member) => member.role === "ADMIN" && member.user.email !== null);
    return admin?.user.email ?? null;
  }
}
