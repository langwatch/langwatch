import type { OrganizationMemberProvenance } from "@langwatch/organization-contract";

/** A member a matching domain admitted, as identity answers it. */
export interface MemberDomainAdmission {
  userId: string;
  domain: string;
  automatic: boolean;
}

/**
 * Why each member is here, domain before invitation, `unknown` for everybody
 * else (spec: specs/identity/directory-administration.feature). Explains a
 * member; never grants or withholds anything.
 */
export function memberProvenanceFor({
  userIds,
  admissions,
  invitedUserIds,
}: {
  userIds: readonly string[];
  admissions: readonly MemberDomainAdmission[];
  invitedUserIds: readonly string[];
}): Record<string, OrganizationMemberProvenance> {
  const byDomain = new Map(admissions.map((admission) => [admission.userId, admission]));
  const invited = new Set(invitedUserIds);
  return Object.fromEntries(
    userIds.map((userId): [string, OrganizationMemberProvenance] => {
      const admitted = byDomain.get(userId);
      if (admitted) {
        return [
          userId,
          { source: "domain", domain: admitted.domain, automatic: admitted.automatic },
        ];
      }
      return [userId, invited.has(userId) ? { source: "invited" } : { source: "unknown" }];
    }),
  );
}
