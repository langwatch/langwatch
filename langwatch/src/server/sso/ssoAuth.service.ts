import crypto from "crypto";
import type { OrganizationUserRole, PrismaClient } from "@prisma/client";
import { createLogger } from "../../utils/logger/server";
import {
  afterUserCreate,
  afterAccountCreate,
  afterSessionCreate,
} from "~/server/better-auth/hooks";
import { fireActivityTrackingNurturing } from "@ee/billing/nurturing/hooks/activityTracking";
import { ensureUserSyncedToCio } from "@ee/billing/nurturing/hooks/userSync";
import { SsoAuthRepository } from "./ssoAuth.repository";
import type { OAuthUserInfo } from "./ssoOAuth";

const logger = createLogger("langwatch:sso:auth");

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const ROLE_PRIORITY: Record<string, number> = {
  ADMIN: 3,
  MEMBER: 2,
  EXTERNAL: 1,
};

interface RoleMappingConfig {
  defaultOrgRole: OrganizationUserRole;
  roleMapping: Record<string, unknown> | null;
}

interface SsoLoginResult {
  sessionToken: string;
  expiresAt: Date;
  redirectTo?: string;
}

export class SsoAuthService {
  private readonly repository: SsoAuthRepository;

  constructor(private readonly prisma: PrismaClient) {
    this.repository = SsoAuthRepository.create(prisma);
  }

  static create(prisma: PrismaClient): SsoAuthService {
    return new SsoAuthService(prisma);
  }

  async handleSsoCallback({
    userInfo,
    provider,
    organizationId,
    roleMappingConfig,
    ipAddress,
    userAgent,
  }: {
    userInfo: OAuthUserInfo;
    provider: string;
    organizationId: string;
    roleMappingConfig: RoleMappingConfig;
    ipAddress: string | null;
    userAgent: string | null;
  }): Promise<SsoLoginResult> {
    let user = await this.repository.findUserByEmail({
      email: userInfo.email,
    });

    if (!user) {
      user = await this.repository.createUser({
        email: userInfo.email,
        name: userInfo.name ?? userInfo.email.split("@")[0] ?? "SSO User",
        image: userInfo.picture ?? null,
      });

      await afterUserCreate({
        prisma: this.prisma,
        user: { id: user.id, email: user.email!, name: user.name ?? "" },
      });
    }

    if (user.deactivatedAt) {
      return {
        sessionToken: "",
        expiresAt: new Date(),
        redirectTo: `/auth/signin?error=${encodeURIComponent("Your account has been deactivated.")}`,
      };
    }

    const existingAccount = await this.repository.findAccount({
      userId: user.id,
      provider,
      providerAccountId: userInfo.sub,
    });

    if (!existingAccount) {
      await this.repository.createAccount({
        userId: user.id,
        provider,
        providerAccountId: userInfo.sub,
      });

      await afterAccountCreate({
        prisma: this.prisma,
        account: {
          userId: user.id,
          providerId: provider,
          accountId: userInfo.sub,
        },
      });
    }

    await this.applyRoleMapping({
      userId: user.id,
      organizationId,
      userInfo,
      config: roleMappingConfig,
    });

    const sessionToken = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

    await this.repository.createSession({
      sessionToken,
      userId: user.id,
      expiresAt,
      ipAddress,
      userAgent,
    });

    await afterSessionCreate({
      prisma: this.prisma,
      userId: user.id,
      fireActivityTrackingNurturing,
      ensureUserSyncedToCio,
    });

    return { sessionToken, expiresAt };
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

    return this.repository.isSoleAdmin({
      userId: user.id,
      organizationId,
    });
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

  private async applyRoleMapping({
    userId,
    organizationId,
    userInfo,
    config,
  }: {
    userId: string;
    organizationId: string;
    userInfo: OAuthUserInfo;
    config: RoleMappingConfig;
  }): Promise<void> {
    const membership = await this.repository.findMembership({
      userId,
      organizationId,
    });

    if (!membership) return;
    if (membership.scimManaged) return;

    const resolvedRole = this.resolveRole({ userInfo, config });

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

  private resolveRole({
    userInfo,
    config,
  }: {
    userInfo: OAuthUserInfo;
    config: RoleMappingConfig;
  }): OrganizationUserRole {
    const roleMap = (config.roleMapping ?? {}) as Record<string, unknown>;
    const useRoleAttribute = roleMap.useRoleAttribute === true;
    const groupMappings = (roleMap.groupMappings ?? []) as Array<{
      group: string;
      role: string;
    }>;

    if (useRoleAttribute && userInfo.role) {
      const normalized = userInfo.role.toUpperCase();
      if (normalized === "ADMIN" || normalized === "MEMBER" || normalized === "EXTERNAL") {
        return normalized as OrganizationUserRole;
      }
    }

    if (groupMappings.length > 0 && userInfo.groups && userInfo.groups.length > 0) {
      let highestRole: OrganizationUserRole | null = null;
      let highestPriority = 0;

      for (const mapping of groupMappings) {
        if (userInfo.groups.includes(mapping.group)) {
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

    return config.defaultOrgRole;
  }
}
