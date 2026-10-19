import { PrismaRepository } from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";

import type { SignUpPolicyRepository } from "../sign-up-policy.repository.ts";

type PrismaSignUpPolicyDatabase = Pick<PrismaClient, "organization" | "organizationInvite">;

export class PrismaSignUpPolicyRepository
  extends PrismaRepository.for("Organization", "OrganizationInvite")
  implements SignUpPolicyRepository
{
  private constructor(prisma: PrismaSignUpPolicyDatabase) {
    super(prisma);
  }

  static create(prisma: PrismaSignUpPolicyDatabase): PrismaSignUpPolicyRepository {
    return new PrismaSignUpPolicyRepository(prisma);
  }

  /** One row at most: the organization guard admits this read for `findFirst` only. */
  async findPendingInviteCodes({ email }: { email: string }): Promise<string[]> {
    const invite = await this.prisma.organizationInvite.findFirst({
      where: {
        email: { equals: email, mode: "insensitive" },
        status: "PENDING",
        OR: [{ expiration: null }, { expiration: { gt: new Date() } }],
      },
      select: { inviteCode: true },
    });
    return invite ? [invite.inviteCode] : [];
  }

  async hasAnyOrganization(): Promise<boolean> {
    const organization = await this.prisma.organization.findFirst({ select: { id: true } });
    return organization !== null;
  }
}
