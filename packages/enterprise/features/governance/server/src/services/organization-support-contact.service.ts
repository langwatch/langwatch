// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * "Contact your admin", resolved for one organization.
 *
 * Two readings of the same question, kept apart because their answers are not
 * interchangeable: `tryResolveSupportContact` may return free text or a URL and is
 * for DISPLAY, `tryResolveOrgAdminEmail` is strictly an address and is what a
 * budget-increase request is actually sent to.
 *
 * They live beside the governance CLI family because that family is what asks:
 * a budget refusal tells a person who to go to, and an organization that has
 * configured nobody gets no name rather than a guess.
 */
import type { OrganizationSupportContactRepository } from "../repositories/organization-support-contact.repository";

export class OrganizationSupportContactService {
  private constructor(private readonly repository: OrganizationSupportContactRepository) {}

  static create({
    repository,
  }: {
    repository: OrganizationSupportContactRepository;
  }): OrganizationSupportContactService {
    return new OrganizationSupportContactService(repository);
  }

  /**
   * The first ADMIN member's email for an organization, or nothing.
   *
   * Membership rows and users are read separately on purpose. The `user`
   * relation is backed by no database foreign key (the schema runs
   * `relationMode = "prisma"`), so an `OrganizationUser` can outlive the `User`
   * it points at. Asking for a required relation join makes a single dangling
   * row reject the whole read with "Inconsistent query result: Field user is
   * required to return data, got null instead". Orphaned memberships are skipped
   * instead, and the first admin that still resolves to a user with an email
   * wins.
   *
   * Nothing when the organization has no admin membership, or when every admin
   * membership is orphaned.
   */
  async tryResolveOrgAdminEmail({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<string | null> {
    const adminUserIds = await this.repository.findAdminUserIds({ organizationId });
    if (adminUserIds.length === 0) {
      return null;
    }

    const emailByUserId = await this.repository.findEmailsByUserIds({ userIds: adminUserIds });

    for (const userId of adminUserIds) {
      const email = emailByUserId.get(userId);
      if (email) {
        return email;
      }
    }

    return null;
  }

  /**
   * The user-facing "contact your admin" string for an organization.
   *
   * Prefers the admin-configured `Organization.supportContact` — free text, so
   * an email, a URL or a short instruction all work — and falls back to the
   * first admin member's email so organizations that never set the override keep
   * working.
   *
   * Nothing when neither resolves: an organization with no admin members yet has
   * no contact to surface, and inventing one would send a blocked person
   * nowhere.
   */
  async tryResolveSupportContact({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<string | null> {
    const configured = await this.repository.tryFindConfiguredSupportContact({ organizationId });
    const trimmed = configured?.trim();
    if (trimmed) {
      return trimmed;
    }

    return this.tryResolveOrgAdminEmail({ organizationId });
  }
}
