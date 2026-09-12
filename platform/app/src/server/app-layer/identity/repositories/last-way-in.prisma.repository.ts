import type { IdentityUserGate } from "@langwatch/identity-server";
import type { PrismaClient } from "~/generated/prisma/client";
import type { LastWayInRecordsPort } from "../last-way-in.service";

/**
 * The two reads behind "is this the last way in": the passkeys a person holds
 * besides the one going, and the credential rows beside them.
 *
 * `Passkey` and `Account` are identity tables under the multitenancy
 * middleware's exemption, so these queries carry no `projectId` — neither
 * model has one, and a sign-in method is not scoped to a project.
 */
export class PrismaLastWayInRepository implements LastWayInRecordsPort {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly routesToIdentity: IdentityUserGate,
  ) {}

  async countOtherPasskeys({
    userId,
    exceptPasskeyId,
  }: {
    userId: string;
    exceptPasskeyId: string;
  }): Promise<number> {
    return await this.prisma.passkey.count({
      where: { userId, id: { not: exceptPasskeyId } },
    });
  }

  async findCredentials({
    userId,
  }: {
    userId: string;
  }): Promise<readonly { provider: string; password: string | null }[]> {
    if (await this.routesToIdentity({ userId })) {
      return await this.prisma.accountCredential.findMany({
        where: { userId },
        select: { provider: true, password: true },
      });
    }

    return await this.prisma.account.findMany({
      where: { userId },
      select: { provider: true, password: true },
    });
  }
}
