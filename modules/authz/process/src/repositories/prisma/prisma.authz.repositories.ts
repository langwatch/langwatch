import type { PrismaClient } from "@langwatch/prisma-client/generated";

import type { AuthzRepositories } from "../authz.repositories.ts";
import { PrismaAuthzAdmissionRepository } from "./prisma.authz-admission.repository.ts";
import { PrismaAuthzBindingRepository } from "./prisma.authz-binding.repository.ts";
import { PrismaAuthzCutoverRepository } from "./prisma.authz-cutover.repository.ts";

/**
 * The live tier: binding facts and engine cutover state, both read from
 * the process's own client. The grant ledger, its projections and the
 * listing reads are built by the module's graph builder instead.
 */
export class PostgresAuthzRepositories {
  static readonly requires = ["prisma"] as const;

  static create(members: Readonly<{ prisma: PrismaClient }>): AuthzRepositories {
    const database = members.prisma;

    return {
      bindings: PrismaAuthzBindingRepository.create({ database }),
      cutover: PrismaAuthzCutoverRepository.create({ database }),
      admissions: PrismaAuthzAdmissionRepository.create({ database }),
    };
  }
}
