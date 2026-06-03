import type { OrganizationUserRole, PrismaClient } from "@prisma/client";
import { createLogger } from "../../utils/logger/server";
import { SsoAuthRepository } from "./ssoAuth.repository";

const logger = createLogger("langwatch:sso:auth");

const ROLE_PRIORITY: Record<string, number> = {
  ADMIN: 3,
  MEMBER: 2,
  EXTERNAL: 1,
};

/** Policy resolved from the SsoProvider row by the better-auth provisionUser hook. */
export interface SsoProvisioningPolicy {
  organizationId: string | null;
  jitProvisioning: boolean;
  defaultOrgRole: OrganizationUserRole;
  roleMapping: unknown;
}

/** Thrown when a user must not be granted an SSO session. */
export class SsoLoginRejectedError extends Error {
  constructor(
    readonly reason:
      | "deactivated"
      | "not_provisioned"
      | "no_organization",
    message: string,
  ) {
    super(message);
    this.name = "SsoLoginRejectedError";
  }
}

/**
 * Bridges the @better-auth/sso plugin to LangWatch's own membership/RBAC model.
 *
 * The plugin handles authentication, user/account linking (by email — which is
 * what makes existing Auth0/Okta users carry over seamlessly), and session
 * creation. This service runs inside the plugin's `provisionUser` callback to
 * apply LangWatch policy the plugin knows nothing about: org membership, JIT
 * provisioning, role mapping, and deactivation/non-provisioned rejection.
 */
export class SsoAuthService {
  private readonly repository: SsoAuthRepository;

  constructor(private readonly prisma: PrismaClient) {
    this.repository = SsoAuthRepository.create(prisma);
  }

  static create(prisma: PrismaClient): SsoAuthService {
    return new SsoAuthService(prisma);
  }

  /**
   * Reconcile a freshly-authenticated SSO user against their organization.
   * Throws {@link SsoLoginRejectedError} to block the session when the user is
   * deactivated or not provisioned (and JIT is off).
   */
  async provisionSsoUser({
    userId,
    policy,
    rawClaims,
  }: {
    userId: string;
    policy: SsoProvisioningPolicy;
    rawClaims: Record<string, unknown>;
  }): Promise<void> {
    if (!policy.organizationId) {
      // Provider not linked to an org: nothing to provision. The user is
      // authenticated but lands on the empty-state / org-selection flow.
      return;
    }
    const organizationId = policy.organizationId;

    if (await this.repository.isUserDeactivated({ userId })) {
      throw new SsoLoginRejectedError(
        "deactivated",
        "Your account has been deactivated.",
      );
    }

    let membership = await this.repository.findMembership({
      userId,
      organizationId,
    });

    if (!membership) {
      if (!policy.jitProvisioning) {
        throw new SsoLoginRejectedError(
          "not_provisioned",
          "Your account is not provisioned for this organization. Contact your administrator.",
        );
      }
      await this.repository.createMembership({
        userId,
        organizationId,
        role: policy.defaultOrgRole,
      });
      membership = { role: policy.defaultOrgRole, scimManaged: false };
      logger.info(
        { userId, organizationId, role: policy.defaultOrgRole },
        "JIT-provisioned org membership via SSO",
      );
    }

    // SCIM-managed memberships are owned by the directory, not the IdP token.
    if (membership.scimManaged) return;

    const resolvedRole = this.resolveRole({
      rawClaims,
      roleMapping: policy.roleMapping,
      defaultOrgRole: policy.defaultOrgRole,
    });

    if (resolvedRole !== membership.role) {
      await this.repository.updateMembershipRole({
        userId,
        organizationId,
        role: resolvedRole,
      });
      logger.info(
        { userId, organizationId, from: membership.role, to: resolvedRole },
        "Applied SSO role mapping",
      );
    }
  }

  async isSoleAdminByEmail({
    email,
    organizationId,
  }: {
    email: string;
    organizationId: string;
  }): Promise<boolean> {
    const user = await this.repository.findUserByEmail({ email });
    if (!user) return false;
    return this.repository.isSoleAdmin({ userId: user.id, organizationId });
  }

  async findMembership({
    userId,
    organizationId,
  }: {
    userId: string;
    organizationId: string;
  }): Promise<{ role: OrganizationUserRole; scimManaged: boolean } | null> {
    return this.repository.findMembership({ userId, organizationId });
  }

  async updateMembershipRole({
    userId,
    organizationId,
    role,
  }: {
    userId: string;
    organizationId: string;
    role: OrganizationUserRole;
  }): Promise<void> {
    return this.repository.updateMembershipRole({ userId, organizationId, role });
  }

  /**
   * Map IdP group/role claims to an org role. Group-priority based: the
   * highest-ranked role across all matched groups wins; `useRoleAttribute`
   * trusts a direct role claim instead.
   */
  private resolveRole({
    rawClaims,
    roleMapping,
    defaultOrgRole,
  }: {
    rawClaims: Record<string, unknown>;
    roleMapping: unknown;
    defaultOrgRole: OrganizationUserRole;
  }): OrganizationUserRole {
    const map = (roleMapping ?? {}) as {
      useRoleAttribute?: boolean;
      groupMappings?: Array<{ group: string; role: string }>;
      groupsClaim?: string;
      roleClaim?: string;
    };

    if (map.useRoleAttribute) {
      const roleValue = rawClaims[map.roleClaim ?? "role"];
      if (typeof roleValue === "string") {
        const normalized = roleValue.toUpperCase();
        if (
          normalized === "ADMIN" ||
          normalized === "MEMBER" ||
          normalized === "EXTERNAL"
        ) {
          return normalized as OrganizationUserRole;
        }
      }
    }

    const groupMappings = map.groupMappings ?? [];
    const rawGroups = rawClaims[map.groupsClaim ?? "groups"];
    const groups = Array.isArray(rawGroups)
      ? rawGroups.filter((g): g is string => typeof g === "string")
      : [];

    if (groupMappings.length > 0 && groups.length > 0) {
      let highestRole: OrganizationUserRole | null = null;
      let highestPriority = 0;
      for (const mapping of groupMappings) {
        if (groups.includes(mapping.group)) {
          const normalized = mapping.role.toUpperCase() as OrganizationUserRole;
          const priority = ROLE_PRIORITY[normalized] ?? 0;
          if (priority > highestPriority) {
            highestPriority = priority;
            highestRole = normalized;
          }
        }
      }
      if (highestRole) return highestRole;
    }

    return defaultOrgRole;
  }
}
