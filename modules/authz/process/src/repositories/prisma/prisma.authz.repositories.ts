import type { PrismaClient } from "@langwatch/prisma-client/generated";

import type { AuthzRepositories } from "../authz.repositories.ts";
import { EventingAuthzPlatformGrantRepository } from "../eventing/eventing.authz-platform-grant.repository.ts";
import { PrismaAuthzAdmissionRepository } from "./prisma.authz-admission.repository.ts";
import { PrismaAuthzAuditRepository } from "./prisma.authz-audit.repository.ts";
import { PrismaAuthzCutoverRepository } from "./prisma.authz-cutover.repository.ts";
import { PrismaAuthzManagedGrantRepository } from "./prisma.authz-managed-grant.repository.ts";
import { PrismaAuthzMembershipStampRepository } from "./prisma.authz-membership-stamp.repository.ts";
import { PrismaAuthzProjectionRepository } from "./prisma.authz-projection.repository.ts";
import { PrismaAuthzRevocationRepository } from "./prisma.authz-revocation.repository.ts";
import { PrismaAuthzUserStandingRepository } from "./prisma.authz-user-standing.repository.ts";

export type AuthzPostgresRepositories = Omit<AuthzRepositories, "epoch" | "sessionVersions">;

/**
 * The Postgres rows: binding facts, engine cutover, admissions, standings, the audit trail, the
 * platform tier, membership stamps, the guarded projection writes and the synchronous deny. The
 * ledger, the decision reads and the listing reads are still built by the module's graph builder.
 */
export class PostgresAuthzRepositories {
  static create({ prisma }: Readonly<{ prisma: PrismaClient }>): AuthzPostgresRepositories {
    return {
      bindings: PrismaAuthzManagedGrantRepository.create({ database: prisma }),
      cutover: PrismaAuthzCutoverRepository.create({ database: prisma }),
      admissions: PrismaAuthzAdmissionRepository.create({ database: prisma }),
      userStandings: PrismaAuthzUserStandingRepository.create({ database: prisma }),
      auditTrail: PrismaAuthzAuditRepository.create(prisma),
      platformGrants: EventingAuthzPlatformGrantRepository.create(prisma),
      membershipStamps: PrismaAuthzMembershipStampRepository.create({ database: prisma }),
      grantProjection: PrismaAuthzProjectionRepository.create(prisma),
      revocation: PrismaAuthzRevocationRepository.create({ database: prisma }),
    };
  }
}
