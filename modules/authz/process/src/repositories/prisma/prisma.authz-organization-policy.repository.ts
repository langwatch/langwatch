import type { AuthzOrganizationPolicy } from "@langwatch/authz-contract";
import { prismaTables, skipTenantCheck } from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";

import { defaultOrganizationPolicy } from "../../rules/organization-policy.rules.ts";
import { AuthzOrganizationPolicyRepository } from "../authz-organization-policy.repository.ts";

export type AuthzOrganizationPolicyDatabase = Pick<PrismaClient, "$queryRaw" | "$executeRaw">;

type PolicyRow = {
  braidsOrganizationAdminsOnly: boolean;
  updatedByUserId: string;
  updatedAt: Date;
};

/** ADR-185 Schema: `AuthzOrganizationPolicy`, keyed by the organisation; no row means off. */
export class PrismaAuthzOrganizationPolicyRepository extends AuthzOrganizationPolicyRepository {
  static readonly tables = prismaTables("AuthzOrganizationPolicy");

  static create(options: {
    database: AuthzOrganizationPolicyDatabase;
  }): PrismaAuthzOrganizationPolicyRepository {
    return new PrismaAuthzOrganizationPolicyRepository(options.database);
  }

  private constructor(private readonly database: AuthzOrganizationPolicyDatabase) {
    super();
  }

  async getPolicy({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<AuthzOrganizationPolicy> {
    const [row] = await this.database.$queryRaw<PolicyRow[]>`
      ${skipTenantCheck({
        // The row is keyed by the organization itself.
        SKIP_TENANT_CHECK: true,
      })}
      SELECT "braidsOrganizationAdminsOnly", "updatedByUserId", "updatedAt"
        FROM "AuthzOrganizationPolicy"
       WHERE "organizationId" = ${organizationId}
    `;
    if (!row) return defaultOrganizationPolicy({ organizationId });
    return {
      organizationId,
      braidsOrganizationAdminsOnly: row.braidsOrganizationAdminsOnly,
      updatedByUserId: row.updatedByUserId,
      updatedAtMs: row.updatedAt.getTime(),
    };
  }

  async setBraidsOrganizationAdminsOnly({
    organizationId,
    braidsOrganizationAdminsOnly,
    updatedByUserId,
  }: {
    organizationId: string;
    braidsOrganizationAdminsOnly: boolean;
    updatedByUserId: string;
  }): Promise<void> {
    await this.database.$executeRaw`
      ${skipTenantCheck({
        // The row is keyed by the organization itself.
        SKIP_TENANT_CHECK: true,
      })}
      INSERT INTO "AuthzOrganizationPolicy"
        ("organizationId", "braidsOrganizationAdminsOnly", "updatedByUserId", "updatedAt")
      VALUES (${organizationId}, ${braidsOrganizationAdminsOnly}, ${updatedByUserId}, now())
      ON CONFLICT ("organizationId") DO UPDATE
        SET "braidsOrganizationAdminsOnly" = EXCLUDED."braidsOrganizationAdminsOnly",
            "updatedByUserId" = EXCLUDED."updatedByUserId",
            "updatedAt" = now()
    `;
  }
}
