import type { IdentityApi } from "@langwatch/identity-contract";

import type { OrganizationUserDirectoryRepository } from "../repositories/organization-user-directory.repository.ts";

/** One person's own verified address, the identity directory's, read through this process. */
export interface OrganizationDirectory {
  findVerifiedEmail(input: Readonly<{ userId: string }>): Promise<string | null>;
  findProvenAddresses(input: Readonly<{ userId: string }>): Promise<string[]>;
}

/**
 * One person's verified address.
 * The address comes from the SAME identity application `user.*` answers from;
 * the fallback is the legacy verified column.
 */
export class OrganizationDirectoryService implements OrganizationDirectory {
  static create(options: {
    identity: Pick<IdentityApi, "verifiedEmailsOf">;
    userDirectory: OrganizationUserDirectoryRepository;
  }): OrganizationDirectoryService {
    return new OrganizationDirectoryService(options);
  }

  private constructor(
    private readonly options: {
      identity: Pick<IdentityApi, "verifiedEmailsOf">;
      userDirectory: OrganizationUserDirectoryRepository;
    },
  ) {}

  async findVerifiedEmail({ userId }: Readonly<{ userId: string }>): Promise<string | null> {
    return (await this.findProvenAddresses({ userId }))[0] ?? null;
  }

  /**
   * Every address this person has PROVEN: identifiers first, else the legacy
   * column only where verified. The one rule the join door and the invitation
   * lookup share, so neither can see an address the other cannot.
   */
  async findProvenAddresses({ userId }: Readonly<{ userId: string }>): Promise<string[]> {
    const verified = await this.options.identity.verifiedEmailsOf({ userId });
    if (verified.kind === "resolved") return verified.emails.map(({ value }) => value);
    const legacy = await this.options.userDirectory.findLegacyVerifiedEmail(userId);
    return legacy === null ? [] : [legacy];
  }
}
