/**
 * Why each member of an organization is here.
 *
 * The one question an administrator asks of a member list they did not build
 * themselves, and until now the answer was a support ticket: somebody appears
 * in the list and nothing on screen says whether a colleague invited them,
 * whether the domain policy let them walk in, or whether the identity
 * provider created them. Three very different conversations, and the row
 * looked identical for all three.
 *
 * Four answers and no fifth, in the order they take precedence:
 *
 *   - DIRECTORY — the identity provider created this person and owns them.
 *     First, because it outranks the others: a person the directory manages
 *     is the directory's to remove, whatever else happened earlier.
 *   - DOMAIN — a matching domain admitted them, either because an
 *     administrator approved the request or because the policy admitted them
 *     with nobody in the loop. Which of the two is carried, because "nobody
 *     approved this" is the fact that makes a surprising member alarming.
 *   - INVITED — somebody here asked them in.
 *   - UNKNOWN — everybody else, and it renders as no chip at all rather than
 *     as a guess. The person who created the organization is the common case,
 *     and inventing a provenance for them would make the other three chips
 *     less believable.
 *
 * Nothing here is a permission decision. Provenance explains a member; it
 * never grants or withholds anything, and no caller reads it to decide.
 */

/** Why one member is in this organization. */
export type MemberProvenance =
  | { source: "directory"; providerId: string | null }
  | { source: "domain"; domain: string; automatic: boolean }
  | { source: "invited" }
  | { source: "unknown" };

/** One person the identity provider created, and which connection did it. */
export interface DirectoryProvisionedMember {
  userId: string;
  providerId: string | null;
}

/** One person a matching domain admitted, and whether anybody approved it. */
export interface DomainAdmittedMember {
  userId: string;
  domain: string;
  automatic: boolean;
}

/**
 * The three reads, each bounded by the organization asked about.
 *
 * `userIds` is passed in rather than derived, so every query is bounded by a
 * finite list of people the caller can already see — the members of the
 * organization they hold `organization:manage` on.
 */
export interface MemberProvenancePort {
  directoryProvisioned(args: {
    organizationId: string;
    userIds: readonly string[];
  }): Promise<DirectoryProvisionedMember[]>;
  domainAdmitted(args: {
    organizationId: string;
    userIds: readonly string[];
  }): Promise<DomainAdmittedMember[]>;
  invitedUserIds(args: {
    organizationId: string;
    userIds: readonly string[];
  }): Promise<string[]>;
}

export class MemberProvenanceService {
  constructor(private readonly deps: { reads: MemberProvenancePort }) {}

  /**
   * Why each of these people is in this organization, keyed by user id.
   *
   * Everybody asked about gets an answer, including `unknown`: a member
   * missing from the map would read as "still loading" on the screen, and an
   * administrator scanning for the people the directory owns cannot tell
   * those two apart.
   */
  async forMembers({
    organizationId,
    userIds,
  }: {
    organizationId: string;
    userIds: readonly string[];
  }): Promise<Record<string, MemberProvenance>> {
    if (userIds.length === 0) return {};

    const [directory, domain, invited] = await Promise.all([
      this.deps.reads.directoryProvisioned({ organizationId, userIds }),
      this.deps.reads.domainAdmitted({ organizationId, userIds }),
      this.deps.reads.invitedUserIds({ organizationId, userIds }),
    ]);

    const byDirectory = new Map(
      directory.map((row) => [row.userId, row.providerId]),
    );
    const byDomain = new Map(domain.map((row) => [row.userId, row]));
    const wasInvited = new Set(invited);

    const answer: Record<string, MemberProvenance> = {};
    for (const userId of userIds) {
      if (byDirectory.has(userId)) {
        answer[userId] = {
          source: "directory",
          providerId: byDirectory.get(userId) ?? null,
        };
        continue;
      }
      const admitted = byDomain.get(userId);
      if (admitted) {
        answer[userId] = {
          source: "domain",
          domain: admitted.domain,
          automatic: admitted.automatic,
        };
        continue;
      }
      answer[userId] = wasInvited.has(userId)
        ? { source: "invited" }
        : { source: "unknown" };
    }
    return answer;
  }
}
