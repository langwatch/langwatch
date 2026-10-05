import type { OrganizationApi } from "@langwatch/organization-contract";
import { UserCapabilityUnavailableError } from "@langwatch/user-contract";

import type { UserOrganizationDirectoryRepository } from "../repositories/user-organization-directory.repository.ts";

/**
 * The organization reads `/me` renders (support contact, name, first project) and the
 * administrator a budget request goes to. The settings read goes through organization itself.
 */
export class UserOrganizationDirectoryService {
  static create(options: {
    directory: UserOrganizationDirectoryRepository;
    organizations: Pick<OrganizationApi, "getSettings">;
  }): UserOrganizationDirectoryService {
    return new UserOrganizationDirectoryService(options.directory, options.organizations);
  }

  private constructor(
    private readonly directory: UserOrganizationDirectoryRepository,
    private readonly organizations: Pick<OrganizationApi, "getSettings">,
  ) {}

  /** Admin-configured support contact, else the first admin's address. */
  async findSupportContact({ organizationId }: { organizationId: string }): Promise<string | null> {
    const settings = await this.organizations.getSettings({ organizationId });
    if (settings.supportContact) return settings.supportContact;

    return this.directory.findFirstAdminEmail(organizationId);
  }

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
