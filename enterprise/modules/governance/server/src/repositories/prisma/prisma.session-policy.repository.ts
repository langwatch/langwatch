import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { PrismaOrganizationSessionPolicyRepository } from "./prisma.organization-session-policy.repository.ts";
import { OrganizationSessionPolicyService } from "../../services/organization-session-policy.service.ts";

// Postgres composition: wires repository into service (the only Postgres binding
// point allowed per prisma-containment policy).
export class PrismaSessionPolicyRepository {
  static create(prisma: PrismaClient): OrganizationSessionPolicyService {
    return OrganizationSessionPolicyService.create(
      PrismaOrganizationSessionPolicyRepository.create(prisma),
    );
  }
}
