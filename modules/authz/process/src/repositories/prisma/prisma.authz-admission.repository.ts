import type { AuthzAdmissionScope, AuthzResolveAdmissionInput } from "@langwatch/authz-contract";

import {
  AuthzAdmissionRepository,
  type AuthzAdmissionGrantRow,
  type AuthzAdmissionMarkerRow,
} from "../authz-admission.repository.ts";

/**
 * The membership row carrying the marker, the ledger row it names, and the
 * raw escape hatch the two clearances are written in — each one statement,
 * because the precondition and the write have to commit together.
 */
export type PrismaAuthzAdmissionDatabase = {
  organizationUser: {
    findFirst(args: {
      where: {
        userId: string;
        organizationId: string;
        disabledAt: null;
        user: { deactivatedAt: null };
        pendingSsoGrantId: { not: null };
      };
      select: { pendingSsoGrantId: true; createdAt: true };
    }): Promise<{ pendingSsoGrantId: string | null; createdAt: Date } | null>;
  };
  grant: {
    findFirst(args: {
      where: {
        id: string;
        organizationId: string;
        principalType: "USER";
        principalId: string;
        scopeType: "ORGANIZATION";
        scopeId: string;
      };
      select: { revokedAt: true };
    }): Promise<{ revokedAt: Date | null } | null>;
  };
  $executeRaw(query: TemplateStringsArray, ...values: unknown[]): Promise<number>;
};

export class PrismaAuthzAdmissionRepository extends AuthzAdmissionRepository {
  static create(options: {
    database: PrismaAuthzAdmissionDatabase;
  }): PrismaAuthzAdmissionRepository {
    return new PrismaAuthzAdmissionRepository(options.database);
  }

  private constructor(private readonly database: PrismaAuthzAdmissionDatabase) {
    super();
  }

  async readAdmissionMarker({
    organizationId,
    userId,
  }: AuthzAdmissionScope): Promise<AuthzAdmissionMarkerRow> {
    const membership = await this.database.organizationUser.findFirst({
      where: {
        userId,
        organizationId,
        disabledAt: null,
        user: { deactivatedAt: null },
        pendingSsoGrantId: { not: null },
      },
      select: { pendingSsoGrantId: true, createdAt: true },
    });
    if (!membership?.pendingSsoGrantId) return { found: false };
    return {
      found: true,
      grantId: membership.pendingSsoGrantId,
      occurredAtMs: membership.createdAt.getTime(),
    };
  }

  async readAdmissionGrant({
    organizationId,
    userId,
    grantId,
  }: AuthzResolveAdmissionInput): Promise<AuthzAdmissionGrantRow> {
    const grant = await this.database.grant.findFirst({
      where: {
        id: grantId,
        organizationId,
        principalType: "USER",
        principalId: userId,
        scopeType: "ORGANIZATION",
        scopeId: organizationId,
      },
      select: { revokedAt: true },
    });
    if (!grant) return { found: false };
    return { found: true, revoked: grant.revokedAt !== null };
  }

  async completeAdmission({
    organizationId,
    userId,
    grantId,
  }: AuthzResolveAdmissionInput): Promise<boolean> {
    const updated = await this.database.$executeRaw`
      -- @tenancy: organization-scoped atomic SSO admission completion
      UPDATE "OrganizationUser" AS membership
      SET "pendingSsoGrantId" = NULL,
          "updatedAt" = NOW()
      WHERE membership."userId" = ${userId}
        AND membership."organizationId" = ${organizationId}
        AND membership."pendingSsoGrantId" = ${grantId}
        AND membership."disabledAt" IS NULL
        AND EXISTS (
          SELECT 1
          FROM "User" AS user_row
          WHERE user_row."id" = membership."userId"
            AND user_row."deactivatedAt" IS NULL
        )
        AND EXISTS (
          SELECT 1
          FROM "Grant" AS grant_row
          WHERE grant_row."id" = membership."pendingSsoGrantId"
            AND grant_row."organizationId" = membership."organizationId"
            AND grant_row."principalType" = 'USER'
            AND grant_row."principalId" = membership."userId"
            AND grant_row."scopeType" = 'ORGANIZATION'
            AND grant_row."scopeId" = membership."organizationId"
            AND grant_row."revokedAt" IS NULL
            AND (
              grant_row."expiresAt" IS NULL
              OR grant_row."expiresAt" > NOW()
            )
        )
    `;
    return updated === 1;
  }

  async clearPendingAdmission({
    organizationId,
    userId,
    grantId,
  }: AuthzResolveAdmissionInput): Promise<boolean> {
    const updated = await this.database.$executeRaw`
      -- @tenancy: organization-scoped revoked SSO admission cleanup
      UPDATE "OrganizationUser"
      SET "pendingSsoGrantId" = NULL,
          "updatedAt" = NOW()
      WHERE "userId" = ${userId}
        AND "organizationId" = ${organizationId}
        AND "pendingSsoGrantId" = ${grantId}
    `;
    return updated === 1;
  }
}
