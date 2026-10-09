import type { PrismaClient } from "~/generated/prisma/client";
import type { SignUpPolicyRepository } from "../sign-up-policy";

/** The installation-wide reads behind the sign-up policy. Cross-tenant by
 *  design: whether an address was invited anywhere is the question. */
export class PrismaSignUpPolicyRepository implements SignUpPolicyRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async hasPendingInvite({ email }: { email: string }): Promise<boolean> {
    return (await this.findPendingInviteCode({ email })) !== null;
  }

  async findPendingInviteCode({
    email,
  }: {
    email: string;
  }): Promise<string | null> {
    const invite = await this.prisma.organizationInvite.findFirst({
      where: {
        email: { equals: email, mode: "insensitive" },
        status: "PENDING",
        OR: [{ expiration: null }, { expiration: { gt: new Date() } }],
      },
      select: { inviteCode: true },
    });
    return invite?.inviteCode ?? null;
  }

  async anyUserExists(): Promise<boolean> {
    const user = await this.prisma.user.findFirst({ select: { id: true } });
    return user !== null;
  }

  async anyOrganizationExists(): Promise<boolean> {
    const organization = await this.prisma.organization.findFirst({
      select: { id: true },
    });
    return organization !== null;
  }
}
