/** Which of the reader's organizations governance is scoped to; an unresolved id answers `undefined` rather than a mismatched row. */
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
