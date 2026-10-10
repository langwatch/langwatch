import type { OrganizationMemberProvenance } from "./organization.responses.ts";

/** A member a matching domain admitted, as identity answers it. */
export interface MemberDomainAdmission {
  userId: string;
  domain: string;
  automatic: boolean;
}

/** A member a directory created, as scim answers it. */
export interface MemberDirectoryClaim {
  userId: string;
  providerId: string | null;
}

/** A member single sign-on admitted on arrival, as identity answers it. */
export interface MemberSsoAdmission {
  userId: string;
  connectionId: string;
}

/**
 * Why each member is here: directory, then single sign-on, then domain, then invitation,
 * `unknown` for everybody else (spec: specs/identity/directory-administration.feature).
 * Explains a member; never grants or withholds anything.
 */
export function memberProvenanceFor({
  userIds,
  directoryMembers = [],
  ssoAdmissions = [],
  admissions,
  invitedUserIds,
}: {
  userIds: readonly string[];
  directoryMembers?: readonly MemberDirectoryClaim[];
  ssoAdmissions?: readonly MemberSsoAdmission[];
  admissions: readonly MemberDomainAdmission[];
  invitedUserIds: readonly string[];
}): Record<string, OrganizationMemberProvenance> {
  const byDirectory = new Map(directoryMembers.map((claim) => [claim.userId, claim]));
  const bySso = new Map(ssoAdmissions.map((admission) => [admission.userId, admission]));
  const byDomain = new Map(admissions.map((admission) => [admission.userId, admission]));
  const invited = new Set(invitedUserIds);
  return Object.fromEntries(
    userIds.map((userId): [string, OrganizationMemberProvenance] => {
      const claimed = byDirectory.get(userId);
      if (claimed) return [userId, { source: "directory", providerId: claimed.providerId }];
      const arrived = bySso.get(userId);
      if (arrived) return [userId, { source: "sso", connectionId: arrived.connectionId }];
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
