import type { SignUpHealth } from "@langwatch/ops-contract";
import type { OrganizationFounding } from "@langwatch/organization-contract";

/** Thirty days, per D12: long enough to catch "I found my real team later", short enough
 *  that a genuine second organization founded a year on is not counted as a mistake. */
export const ORPHANED_ORGANIZATION_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * An organization is orphaned when its founder, holding a proved domain, joined a
 * different organization within the window of founding it. Main's same-domain
 * check always counted the founder's own identifier, so a proved domain is the test.
 */
export function resolveSignUpHealth({
  founded,
  provedFounders,
  fromMs,
  toMs,
  windowMs = ORPHANED_ORGANIZATION_WINDOW_MS,
}: {
  founded: readonly OrganizationFounding[];
  provedFounders: ReadonlySet<string>;
  fromMs: number;
  toMs: number;
  windowMs?: number;
}): SignUpHealth {
  const orphanedOrganizations = founded.filter(
    (organization) =>
      provedFounders.has(organization.founderUserId) &&
      organization.founderMemberships.some(
        (membership) =>
          membership.organizationId !== organization.organizationId &&
          membership.joinedAtMs >= organization.foundedAtMs &&
          membership.joinedAtMs - organization.foundedAtMs <= windowMs,
      ),
  ).length;

  return {
    organizationsFounded: founded.length,
    orphanedOrganizations,
    orphanedRate: founded.length === 0 ? 0 : orphanedOrganizations / founded.length,
    fromMs,
    toMs,
  };
}
