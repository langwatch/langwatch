import type { PrismaClient } from "@langwatch/prisma-client/generated";

import type {
  OrganizationSignInSecurityRule,
  SignInSecuritySettingsRepository,
} from "../sign-in-security-settings.repository.ts";

type Database = Pick<PrismaClient, "organization">;

const ruleSelect = {
  lockoutAfterFailedAttempts: true,
  lockoutMinutes: true,
  sessionIdleTimeoutMinutes: true,
  sessionMaxLifetimeMinutes: true,
} as const;

type RuleRow = {
  lockoutAfterFailedAttempts: number;
  lockoutMinutes: number;
  sessionIdleTimeoutMinutes: number;
  sessionMaxLifetimeMinutes: number;
};

const ruleOf = (row: RuleRow): OrganizationSignInSecurityRule => ({
  lockout: {
    afterFailedAttempts: row.lockoutAfterFailedAttempts,
    lockMinutes: row.lockoutMinutes,
  },
  sessionBound: {
    idleTimeoutMinutes: row.sessionIdleTimeoutMinutes,
    maxLifetimeMinutes: row.sessionMaxLifetimeMinutes,
  },
});

/** The four sign-in security columns an organization sets (GAC-09, GAC-10). */
export class PrismaSignInSecuritySettingsRepository implements SignInSecuritySettingsRepository {
  static create(database: Database): PrismaSignInSecuritySettingsRepository {
    return new PrismaSignInSecuritySettingsRepository(database);
  }

  private constructor(private readonly database: Database) {}

  async findForUser({
    userId,
  }: {
    userId: string;
  }): Promise<readonly OrganizationSignInSecurityRule[]> {
    // Through `Organization` filtered by membership, never `OrganizationUser`
    // keyed only by `userId`: that spans every tenant at once and the
    // org-tenancy guard refuses it (ADR-021), underneath the session read.
    const rows = await this.database.organization.findMany({
      where: { members: { some: { userId, disabledAt: null } } },
      select: ruleSelect,
    });

    return rows.map(ruleOf);
  }

  async findConfigured(): Promise<readonly OrganizationSignInSecurityRule[]> {
    const rows = await this.database.organization.findMany({
      where: {
        OR: [
          { lockoutAfterFailedAttempts: { gt: 0 } },
          { sessionIdleTimeoutMinutes: { gt: 0 } },
          { sessionMaxLifetimeMinutes: { gt: 0 } },
        ],
      },
      select: ruleSelect,
    });

    return rows.map(ruleOf);
  }

  async findForOrganization({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<readonly OrganizationSignInSecurityRule[]> {
    const rows = await this.database.organization.findMany({
      where: { id: organizationId },
      select: ruleSelect,
    });

    return rows.map(ruleOf);
  }

  async save({
    organizationId,
    rule,
  }: {
    organizationId: string;
    rule: OrganizationSignInSecurityRule;
  }): Promise<void> {
    await this.database.organization.update({
      where: { id: organizationId },
      data: {
        lockoutAfterFailedAttempts: rule.lockout.afterFailedAttempts,
        lockoutMinutes: rule.lockout.lockMinutes,
        sessionIdleTimeoutMinutes: rule.sessionBound.idleTimeoutMinutes,
        sessionMaxLifetimeMinutes: rule.sessionBound.maxLifetimeMinutes,
      },
    });
  }
}
