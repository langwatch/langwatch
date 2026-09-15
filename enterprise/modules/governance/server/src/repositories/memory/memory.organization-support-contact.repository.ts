// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { OrganizationSupportContactRepository } from "../directory/organization-support-contact.repository.ts";
import type { MemoryGovernanceStore } from "./memory-governance.store.ts";

/**
 * The support-contact twin. Admin seats and user emails are separate reads
 * here as well, so a membership with no user behind it drops out of the
 * answer instead of rejecting it.
 */
export class MemoryOrganizationSupportContactRepository extends OrganizationSupportContactRepository {
  private constructor(private readonly store: MemoryGovernanceStore) {
    super();
  }

  static create(store: MemoryGovernanceStore): MemoryOrganizationSupportContactRepository {
    return new MemoryOrganizationSupportContactRepository(store);
  }

  async findAdminUserIds({ organizationId }: { organizationId: string }): Promise<string[]> {
    return this.store.members
      .filter((member) => member.organizationId === organizationId && member.isAdmin)
      .map((member) => member.userId);
  }

  async findEmailsByUserIds({ userIds }: { userIds: string[] }): Promise<Map<string, string | null>> {
    const emails = new Map<string, string | null>();
    for (const userId of userIds) {
      const person = this.store.people.get(userId);
      if (person) emails.set(userId, person.email);
    }
    return emails;
  }

  async findConfiguredSupportContact({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<string | null> {
    return this.store.supportContacts.get(organizationId) ?? null;
  }
}
