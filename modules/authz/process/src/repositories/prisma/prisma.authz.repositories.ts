import type { PrismaClient } from "@langwatch/prisma-client/generated";

import type { AuthzRepositories } from "../authz.repositories.ts";
import { PrismaAuthzAdmissionRepository } from "./prisma.authz-admission.repository.ts";
import { PrismaAuthzCutoverRepository } from "./prisma.authz-cutover.repository.ts";
import { PrismaAuthzManagedGrantRepository } from "./prisma.authz-managed-grant.repository.ts";
import { PrismaAuthzUserStandingRepository } from "./prisma.authz-user-standing.repository.ts";

export type AuthzPostgresRepositories = Omit<AuthzRepositories, "epoch" | "sessionVersions">;

/**
 * The Postgres rows: binding facts, engine cutover, admissions and standings. The grant
 * ledger, its projections and the listing reads are still built by the module's graph builder.
 */
export class PostgresAuthzRepositories {
  static create({ prisma }: Readonly<{ prisma: PrismaClient }>): AuthzPostgresRepositories {
    return {
      bindings: PrismaAuthzManagedGrantRepository.create({ database: prisma }),
      cutover: PrismaAuthzCutoverRepository.create({ database: prisma }),
      admissions: PrismaAuthzAdmissionRepository.create({ database: prisma }),
      userStandings: PrismaAuthzUserStandingRepository.create({ database: prisma }),
    };
  }
}
