import type { PrismaClient } from "@langwatch/prisma-client/generated";

import { SignUpPolicyRepository } from "../sign-up-policy.repository.ts";

export class PrismaSignUpPolicyRepository extends SignUpPolicyRepository {
  private constructor(private readonly database: PrismaClient) {
    super();
  }

  static create(database: PrismaClient): PrismaSignUpPolicyRepository {
    return new PrismaSignUpPolicyRepository(database);
  }

  /** One row at most: the organization guard admits this read for `findFirst` only. */
  async findPendingInviteCodes({ email }: { email: string }): Promise<string[]> {
    const invite = await this.database.organizationInvite.findFirst({
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
    const organization = await this.database.organization.findFirst({ select: { id: true } });
    return organization !== null;
  }
}
