import type { AuthzAdmissionScope, AuthzResolveAdmissionInput } from "@langwatch/authz-contract";
import { z } from "zod";

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
  $queryRaw(query: TemplateStringsArray, ...values: unknown[]): Promise<unknown>;
};

const inactiveRowsSchema = z.array(z.object({ userId: z.string() }));

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
        pendingSsoGrantId: { not: null },
      },
      select: { pendingSsoGrantId: true, createdAt: true },
    });
    if (!membership?.pendingSsoGrantId) return { found: false };
    if (await this.isInactive(userId)) return { found: false };
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
        AND NOT EXISTS (
          SELECT 1
          FROM "AuthzUserStanding" AS standing
          WHERE standing."userId" = membership."userId"
            AND (standing."deactivatedAt" IS NOT NULL OR standing."erasedAt" IS NOT NULL)
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

  /** Deactivated or erased, as authz's own standing table says (never the User table). */
  private async isInactive(userId: string): Promise<boolean> {
    const rows = await this.database.$queryRaw`
      -- @tenancy: platform-wide; a user's standing belongs to no organization
      SELECT "userId" FROM "AuthzUserStanding"
      WHERE "userId" = ${userId}
        AND ("deactivatedAt" IS NOT NULL OR "erasedAt" IS NOT NULL)
    `;
    return inactiveRowsSchema.parse(rows).length > 0;
  }
}
