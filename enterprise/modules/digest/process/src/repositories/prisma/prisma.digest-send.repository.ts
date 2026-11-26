// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import {
  type PrismaModelClient,
  PrismaRepository,
  skipTenantCheck,
} from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";

import { digestSendKey } from "../../rules/digest-email.rules.ts";
import type { DigestSendRecord, DigestSendRepository } from "../digest-send.repository.ts";

/** The send rows, plus the raw SQL clearing one person's rows across organizations needs. */
type PrismaDigestSendDatabase = PrismaModelClient<"DigestSend"> & Pick<PrismaClient, "$executeRaw">;

export class PrismaDigestSendRepository
  extends PrismaRepository.for("DigestSend")
  implements DigestSendRepository
{
  // Its own create, not `this.factory`: the factory's model-scoped client carries no `$executeRaw`.
  static create({ prisma }: { prisma: PrismaDigestSendDatabase }): PrismaDigestSendRepository {
    return new PrismaDigestSendRepository(prisma);
  }

  private constructor(private readonly database: PrismaDigestSendDatabase) {
    super(database);
  }

  async isSent(input: {
    userId: string;
    organizationId: string;
    isoWeek: string;
  }): Promise<boolean> {
    const row = await this.database.digestSend.findUnique({
      where: { id: digestSendKey(input) },
      select: { id: true },
    });
    return row !== null;
  }

  async claim({ sentAt, ...send }: DigestSendRecord): Promise<boolean> {
    // ON CONFLICT DO NOTHING: two racing attempts both return, and only one counts a row.
    const { count } = await this.database.digestSend.createMany({
      data: [{ id: digestSendKey(send), ...send, sentAt: new Date(sentAt) }],
      skipDuplicates: true,
    });
    return count === 1;
  }

  async forgetUser({ userId }: { userId: string }): Promise<void> {
    await this.database.$executeRaw`
      ${skipTenantCheck({
        // A person's sends are stamped with each organization whose week they carried.
        SKIP_TENANT_CHECK: true,
      })}
      DELETE FROM "DigestSend" WHERE "userId" = ${userId}
    `;
  }
}
