import type { MatchableEmail } from "@langwatch/identity";

/**
 * Every address a person has PROVEN, read the one way both doors read it.
 *
 * Identifiers answer first. A user not on identifiers yet keeps the legacy
 * `User.email` column, counted only where better-auth marked it verified; an
 * unverified address answers nothing. The join door and the invitation
 * lookup both decide on this list, and reading it in two places once let the
 * automatic door admit somebody whose invitation the other read could not
 * see, so the rule lives here and nowhere else. Composed in runtime.ts over
 * the identity email read and the users repository.
 */
export class ProvenAddressesService {
  constructor(
    private readonly reads: {
      verifiedEmailsOf: (args: {
        userId: string;
      }) => Promise<MatchableEmail[] | null>;
      findVerifiedLegacyEmail: (args: {
        userId: string;
      }) => Promise<string | null>;
    },
  ) {}

  async addressesOf({ userId }: { userId: string }): Promise<string[]> {
    const proven = await this.reads.verifiedEmailsOf({ userId });
    if (proven !== null) return proven.map(({ value }) => value);

    const legacy = await this.reads.findVerifiedLegacyEmail({ userId });
    return legacy === null ? [] : [legacy];
  }
}
