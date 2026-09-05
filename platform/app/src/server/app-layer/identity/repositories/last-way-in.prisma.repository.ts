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
  constructor(private readonly prisma: PrismaClient) {}

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

  /**
   * The legacy `Account` rows only. A user whose backfill has finalized keeps
   * their credential on the identity branch instead — reading that branch here
   * is the widening ADR-116 Phase 3 owns, and doing it early would change
   * which removals this guard refuses.
   */
  async findCredentials({
    userId,
  }: {
    userId: string;
  }): Promise<readonly { provider: string; password: string | null }[]> {
    return await this.prisma.account.findMany({
      where: { userId },
      select: { provider: true, password: true },
    });
  }
}
