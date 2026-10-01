// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The rows behind "contact your admin". Membership and users are separate
 * reads because the `user` relation is backed by no database foreign key, so
 * one dangling membership must not reject the whole answer.
 */
export abstract class OrganizationSupportContactRepository {
  /** Admin memberships of one organization, oldest first. */
  abstract findAdminUserIds(input: { organizationId: string }): Promise<string[]>;
  /** The email of each named user that still exists and has one. */
  abstract findEmailsByUserIds(input: { userIds: string[] }): Promise<Map<string, string | null>>;
  /** The admin-configured free-text contact, if the organization set one. */
  abstract findConfiguredSupportContact(input: { organizationId: string }): Promise<string | null>;
}
