import { type MeProject, UserCapabilityUnavailableError } from "@langwatch/user-contract";

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

  /** `/api/me/project`: the calling key's project, read through project's share (R40). */
  async getKeyProject({ projectId }: { projectId: string }): Promise<MeProject> {
    const project = await this.directory.findKeyProject({ projectId });
    if (!project) throw new Error(`no project row for the credential's project "${projectId}"`);

    return project;
  }

  findName({ organizationId }: { organizationId: string }): Promise<string | null> {
    return this.directory.findName(organizationId);
  }

  findFirstProjectSlug(input: { organizationId: string; userId: string }): Promise<string | null> {
    return this.directory.findFirstProjectSlug(input);
  }
}
