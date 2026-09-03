import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { PrismaOrganizationSessionPolicyRepository } from "../repositories/prisma/prisma.organization-session-policy.repository";
import { OrganizationSessionPolicyService } from "../services/organization-session-policy.service";

/**
 * The Postgres composition of the session-policy service.
 *
 * Composition roots reach the feature package through this adapter. It takes
 * the process's typed `PrismaClient`, wires the Prisma-backed repository into
 * the service, and returns the service. Nothing above this file needs to know
 * the repository class exists — the barrel exports the adapter and the service
 * (`OrganizationSessionPolicyService`), never the repository.
 *
 * The adapter is the one place a Postgres binding sits between an application
 * and a feature: it is why the `prisma-containment` policy allows
 * `adapters/postgres.*.adapter.ts` to import `PrismaClient` at all.
 */
export class PostgresSessionPolicyAdapter {
  static create(prisma: PrismaClient): OrganizationSessionPolicyService {
    return OrganizationSessionPolicyService.create(
      PrismaOrganizationSessionPolicyRepository.create(prisma),
    );
  }
}
