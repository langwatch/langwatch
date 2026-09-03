/**
 * Which of the reader's organizations the governance section is scoped to.
 *
 * Not the first one, and not a guess: an unresolved or unreachable
 * organization id answers `undefined` rather than a mismatched row.
 */
import type { GovernanceOrganization } from "@langwatch/enterprise-governance-web/screens/governance";

export function resolveGovernanceOrganization({
  organizationId,
  organizations,
}: {
  organizationId: string | null;
  organizations: readonly GovernanceOrganization[];
}): GovernanceOrganization | undefined {
  if (!organizationId) return void 0;
  return organizations.find((candidate) => candidate.id === organizationId);
}
