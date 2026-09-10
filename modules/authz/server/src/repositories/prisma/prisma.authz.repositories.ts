import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { AuthzRepositories } from "../authz.repositories.ts";
import { PrismaAuthzBindingRepository } from "./prisma.authz-binding.repository.ts";
import { PrismaAuthzCutoverRepository } from "./prisma.authz-cutover.repository.ts";

/**
 * The "postgres" tier: the binding facts and the engine cutover state, both
 * read from the process's own client. The grant ledger, its projections and
 * the listing reads are not here yet - they are built by the module's graph
 * builder from the structural database it is handed.
 */
export class PostgresAuthzRepositories {
  static readonly requires = ["prisma"] as const;

  static create(infrastructure: Readonly<{ prisma: PrismaClient }>): AuthzRepositories {
    const database = infrastructure.prisma;

    return {
      bindings: PrismaAuthzBindingRepository.create({ database }),
      cutover: PrismaAuthzCutoverRepository.create({ database }),
    };
  }
}
