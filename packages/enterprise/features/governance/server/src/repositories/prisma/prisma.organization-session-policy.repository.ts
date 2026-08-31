import type { PrismaClient } from "@langwatch/prisma-client/generated";
import {
  OrganizationSessionPolicyPort,
  type OrganizationSessionPolicy,
} from "../../ports/session-policy.port";

export class PrismaOrganizationSessionPolicyRepository extends OrganizationSessionPolicyPort {
  private constructor(private readonly prisma: PrismaClient) {
    super();
  }

  static create(prisma: PrismaClient): PrismaOrganizationSessionPolicyRepository {
    return new PrismaOrganizationSessionPolicyRepository(prisma);
  }

  async find(organizationId: string): Promise<OrganizationSessionPolicy> {
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { maxSessionDurationDays: true },
    });
    return { maxSessionDurationDays: organization?.maxSessionDurationDays ?? 0 };
  }

  async setMaxDurationDays(
    organizationId: string,
    maxSessionDurationDays: number,
  ): Promise<void> {
    await this.prisma.organization.update({
      where: { id: organizationId },
      data: { maxSessionDurationDays },
    });
  }
}
