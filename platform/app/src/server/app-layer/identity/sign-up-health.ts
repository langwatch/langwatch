/**
 * The rate join-before-create exists to reduce (D12).
 *
 * Today every sign-up mints an organization unconditionally, which is why
 * production carries a long tail of single-person workspaces people abandoned
 * the moment they found their real team. This is how many of them there are.
 *
 * Derived from the rows rather than counted at the moment it happens, and
 * that is the point rather than an implementation detail. A counter can only
 * start counting when somebody adds it, so it can never answer "was this
 * better or worse before the flag went on" — which is the only question worth
 * asking of a number that exists to justify a change. Reading it off
 * `Organization` and `OrganizationUser`, both of which have been written all
 * along, makes any window readable, including every window before this
 * deliverable existed.
 *
 * The signal, in one line: somebody created an organization and then joined a
 * DIFFERENT organization on the same email domain within thirty days. The
 * first one is the workspace they did not mean to create.
 */

/** Thirty days, per D12. Long enough that "I found my real team later" is
 *  caught, short enough that a genuine second organization founded a year on
 *  is not counted as a mistake. */
export const ORPHANED_ORGANIZATION_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/** One organization somebody made, as this reads it. */
export interface FoundedOrganization {
  organizationId: string;
  founderUserId: string;
  foundedAtMs: number;
}

/** One membership somebody later took up somewhere else. */
export interface LaterMembership {
  organizationId: string;
  userId: string;
  joinedAtMs: number;
}

export interface SignUpHealth {
  /** Organizations founded in the window that was read. */
  organizationsFounded: number;
  /** Of those, the ones whose founder joined another organization on the same
   *  domain within thirty days. */
  orphanedOrganizations: number;
  /** Orphaned as a share of founded, in [0, 1]. Zero when nothing was
   *  founded — a period with no sign-ups has no rate to report, and calling
   *  that anything but zero would make an empty window look like a crisis. */
  orphanedRate: number;
  /** The window this answers for, so a reader can tell an empty answer from
   *  an answer about an empty period. */
  fromMs: number;
  toMs: number;
}

/**
 * How many of the organizations founded in a window nobody meant to found.
 *
 * The founder's domain is not compared here, and its absence is deliberate:
 * the CALLER restricts both lists to one domain's people, because "the same
 * domain" is a fact about verified identifiers and this module is pure. What
 * is decided here is only the window and the arithmetic.
 */
export function resolveSignUpHealth({
  founded,
  laterMemberships,
  fromMs,
  toMs,
  windowMs = ORPHANED_ORGANIZATION_WINDOW_MS,
}: {
  founded: readonly FoundedOrganization[];
  laterMemberships: readonly LaterMembership[];
  fromMs: number;
  toMs: number;
  windowMs?: number;
}): SignUpHealth {
  const membershipsByUser = new Map<string, LaterMembership[]>();
  for (const membership of laterMemberships) {
    const held = membershipsByUser.get(membership.userId) ?? [];
    held.push(membership);
    membershipsByUser.set(membership.userId, held);
  }

  const orphanedOrganizations = founded.filter((organization) =>
    (membershipsByUser.get(organization.founderUserId) ?? []).some(
      (membership) =>
        membership.organizationId !== organization.organizationId &&
        membership.joinedAtMs >= organization.foundedAtMs &&
        membership.joinedAtMs - organization.foundedAtMs <= windowMs,
    ),
  ).length;

  return {
    organizationsFounded: founded.length,
    orphanedOrganizations,
    orphanedRate:
      founded.length === 0 ? 0 : orphanedOrganizations / founded.length,
    fromMs,
    toMs,
  };
}
