import { UserCapabilityUnavailableError } from "@langwatch/user-contract";

import type { UserOrganizationDirectoryRepository } from "../repositories/user-organization-directory.repository.ts";

/**
 * The organization reads `/me` renders (name, first project) and the administrator a
 * budget request goes to.
 */
export class UserOrganizationDirectoryService {
  static create(options: {
    directory: UserOrganizationDirectoryRepository;
  }): UserOrganizationDirectoryService {
    return new UserOrganizationDirectoryService(options.directory);
  }

  private constructor(private readonly directory: UserOrganizationDirectoryRepository) {}

  /** Who a budget-increase request goes to. Refuses when nobody administers. */
  async getBudgetIncreaseRecipient({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<string> {
    const adminEmail = await this.directory.findFirstAdminEmail(organizationId);
    if (!adminEmail) {
      throw new UserCapabilityUnavailableError(
        "administrator for this organization to send the budget increase request to",
      );
    }

    return adminEmail;
  }

  findName({ organizationId }: { organizationId: string }): Promise<string | null> {
    return this.directory.findName(organizationId);
  }

  findFirstProjectSlug(input: { organizationId: string; userId: string }): Promise<string | null> {
    return this.directory.findFirstProjectSlug(input);
  }
}
