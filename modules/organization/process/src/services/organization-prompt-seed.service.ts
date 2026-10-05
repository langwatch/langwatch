import type { Logger } from "@langwatch/observability";

/**
 * The prompt tags a new organization is seeded with, and where a compensation failure is
 * reported when provisioning undoes itself — the tag catalogue is the prompt feature's.
 */
export interface OrganizationPromptSeed {
  seedTagsForOrganization(input: { organizationId: string }): Promise<void>;
  reportCompensationFailure(error: Error): void;
}

/**
 * The prompt-tag seeding a new organization gets, absent. The tag catalogue is
 * the prompt feature's and this process composes no route to it, so the seed
 * says so once and provisioning carries on.
 */
export class OrganizationPromptSeedService implements OrganizationPromptSeed {
  static create(options: {
    role: string;
    logger: Pick<Logger, "warn" | "error">;
  }): OrganizationPromptSeedService {
    return new OrganizationPromptSeedService(options.role, options.logger);
  }

  private constructor(
    private readonly role: string,
    private readonly logger: Pick<Logger, "warn" | "error">,
  ) {}

  async seedTagsForOrganization(input: { organizationId: string }): Promise<void> {
    this.logger.warn(
      { organizationId: input.organizationId },
      `organization (${this.role}) composes no prompt service, so the new organization starts with no prompt tags.`,
    );
  }

  reportCompensationFailure(error: Error): void {
    this.logger.error({ error }, "Organization provisioning could not undo its own commit");
  }
}
