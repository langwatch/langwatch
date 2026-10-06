import type { IdentityApi } from "@langwatch/identity-contract";

import type { OrganizationUserDirectoryRepository } from "../repositories/organization-user-directory.repository.ts";

/**
 * One person's own verified address, and the display names a pending list
 * renders. Both are the identity directory's, read through this process.
 */
export interface OrganizationDirectory {
  findVerifiedEmail(input: Readonly<{ userId: string }>): Promise<string | null>;
  findProvenAddresses(input: Readonly<{ userId: string }>): Promise<string[]>;
  listUserNames(
    input: Readonly<{ userIds: readonly string[] }>,
  ): Promise<readonly Readonly<{ id: string; name: string | null }>[]>;
}

/**
 * One person's verified address, and the display names a pending list renders.
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

  // Names only: the local part of a requester's address is not the
  // organization's business until they are a member of it.
  listUserNames({
    userIds,
  }: Readonly<{ userIds: readonly string[] }>): Promise<
    readonly Readonly<{ id: string; name: string | null }>[]
  > {
    return this.options.userDirectory.findUserNames(userIds);
  }
}
